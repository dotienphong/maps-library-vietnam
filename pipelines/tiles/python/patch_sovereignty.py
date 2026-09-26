#!/usr/bin/env python3
"""Patch OSM trước khi build tiles (spec 4.3 tầng 1).

Hai bbox Hoàng Sa / Trường Sa (luật đầy đủ, PHONG chốt lại 26/09/2026):
- Có name:vi: đặt name = name:vi.
- Không có name:vi: GIỮ name nếu là tiếng Việt (có chữ cái riêng tiếng Việt, không chữ Hán/Kana/Hangul);
  ngược lại xoá — tên chữ Hán và tên Latin nước ngoài ("Parola Lighthouse") không hiển thị. Luật cũ xoá
  mọi name thiếu name:vi nên mất 24 tên thật trên đảo ta giữ (Trường Song Tử Tây, Hải đăng Đá Lát…).
- Luôn xoá mọi name:* trừ name:vi trong bbox (name:zh*, name:en, name:ja, name:nan-Hant, name:tl…).
- Áp dụng cho node trong bbox, way có node trong bbox và relation chứa node/way đó.
- Cùng luật tên với POI hai quần đảo (pipelines/poi/src/lib/quan-dao.mjs laTenViet).

Vùng biển Đông mở rộng (DEVLOG 27/08/2026, quyết định phát sinh M1b T5): các núi ngầm/địa vật
mang tên chữ Hán nằm ngay ngoài hai bbox (ví dụ 111,3°E 11,4°N) lọt vào tile giao bbox. Trong
CJK_ZONE chỉ áp luật hẹp: name viết bằng chữ CJK mà không có name:vi → xoá name (có name:vi →
thay); xoá name:zh*. Tên Latin giữ nguyên. Vùng dừng ở 17,5°N để không chạm Hải Nam và phần đệm
biên giới phía bắc của extract (tên Trung Quốc ở đó là hợp lệ).
"""

import argparse
import re

import osmium

BBOXES = [
    ("Hoàng Sa", 111.0, 15.7, 113.0, 17.2),
    ("Trường Sa", 111.5, 6.5, 117.8, 12.0),
]
CHU_VIET_RE = re.compile(
    r"[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]", re.IGNORECASE
)

CJK_ZONE = (102.0, 6.0, 117.8, 17.5)
CJK_DROP_KEYS = {"name:zh", "name:zh-Hans", "name:zh-Hant"}
CJK_RE = re.compile(r"[㐀-鿿぀-ヿ가-힯]")


def in_bboxes(lon, lat):
    return any(west <= lon <= east and south <= lat <= north for _, west, south, east, north in BBOXES)


def in_cjk_zone(lon, lat):
    west, south, east, north = CJK_ZONE
    return west <= lon <= east and south <= lat <= north


def has_cjk_name(tags):
    name = tags.get("name")
    return bool(name and CJK_RE.search(name))


def la_ten_viet(name):
    """Tên tiếng Việt: có chữ cái riêng tiếng Việt, không chữ Hán/Kana/Hangul (không dấu → không nhận)."""
    return bool(name) and bool(CHU_VIET_RE.search(name)) and not CJK_RE.search(name)


def patched_tags(tags):
    """Luật đầy đủ trong bbox. Trả dict tag mới, hoặc None nếu không có gì cần đổi."""
    original = {tag.k: tag.v for tag in tags}
    result = {k: v for k, v in original.items() if not k.startswith("name:") or k == "name:vi"}
    if "name:vi" in result:
        result["name"] = result["name:vi"]
    elif not la_ten_viet(result.get("name")):
        result.pop("name", None)
    return None if result == original else result


def cjk_patched_tags(tags):
    """Luật hẹp trong CJK_ZONE: chỉ đụng name chữ Hán/Nhật/Hàn và name:zh*."""
    result = {tag.k: tag.v for tag in tags}
    changed = False
    if has_cjk_name(result):
        if "name:vi" in result:
            result["name"] = result["name:vi"]
        else:
            del result["name"]
        changed = True
    for key in CJK_DROP_KEYS:
        if key in result:
            del result[key]
            changed = True
    return result if changed else None


class Collector(osmium.SimpleHandler):
    """Pass 1 (locations=True): node/way nào thuộc bbox đầy đủ, node/way nào thuộc vùng CJK."""

    def __init__(self):
        super().__init__()
        self.nodes = set()
        self.ways = set()
        self.cjk_nodes = set()
        self.cjk_ways = set()

    def node(self, node):
        if not node.location.valid():
            return
        lon, lat = node.location.lon, node.location.lat
        if in_bboxes(lon, lat):
            self.nodes.add(node.id)
        elif in_cjk_zone(lon, lat) and has_cjk_name({tag.k: tag.v for tag in node.tags}):
            self.cjk_nodes.add(node.id)

    def way(self, way):
        if any(node.ref in self.nodes for node in way.nodes):
            self.ways.add(way.id)
            return
        if not has_cjk_name({tag.k: tag.v for tag in way.tags}):
            return
        for node in way.nodes:
            if node.location.valid() and in_cjk_zone(node.location.lon, node.location.lat):
                self.cjk_ways.add(way.id)
                return


class Patcher(osmium.SimpleHandler):
    def __init__(self, writer, collector):
        super().__init__()
        self.writer = writer
        self.c = collector
        self.changed = 0

    def _emit(self, obj, add, full, cjk):
        new_tags = None
        if full:
            new_tags = patched_tags(obj.tags)
        elif cjk:
            new_tags = cjk_patched_tags(obj.tags)
        if new_tags is not None:
            self.changed += 1
            add(obj.replace(tags=new_tags))
            return
        add(obj)

    def node(self, node):
        self._emit(node, self.writer.add_node, node.id in self.c.nodes, node.id in self.c.cjk_nodes)

    def way(self, way):
        self._emit(way, self.writer.add_way, way.id in self.c.ways, way.id in self.c.cjk_ways)

    def relation(self, relation):
        hit = any(
            (member.type == "n" and member.ref in self.c.nodes)
            or (member.type == "w" and member.ref in self.c.ways)
            for member in relation.members
        )
        self._emit(relation, self.writer.add_relation, hit, False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src")
    parser.add_argument("dst")
    args = parser.parse_args()

    collector = Collector()
    collector.apply_file(args.src, locations=True)
    writer = osmium.SimpleWriter(args.dst, overwrite=True)  # chạy lại data:update ghi đè bản patch cũ
    try:
        patcher = Patcher(writer, collector)
        patcher.apply_file(args.src)
    finally:
        writer.close()
    print(
        f"patched objects: {patcher.changed}; "
        f"nodes in bbox: {len(collector.nodes)}; ways in bbox: {len(collector.ways)}; "
        f"cjk zone: {len(collector.cjk_nodes)} nodes, {len(collector.cjk_ways)} ways"
    )


if __name__ == "__main__":
    main()

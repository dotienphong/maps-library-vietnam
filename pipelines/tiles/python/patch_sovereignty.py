#!/usr/bin/env python3
"""Patch OSM trước khi build tiles (spec 4.3 tầng 1).

Hai bbox Hoàng Sa / Trường Sa (luật đầy đủ, PHONG chốt lại 26/09/2026 — CÙNG chính sách với POI, đọc
chung pipelines/poi/data/quan-dao-dao.csv và quan-dao-ta-giu.json, xem pipelines/poi/src/lib/quan-dao.mjs):
- Đối tượng có trong danh sách duyệt: name = name:vi = tên Việt ghi đè (name:vi của OSM ở đây thường là
  phiên âm tên TQ, vd "Đảo Triệu Thuật" = Đảo Cây); tên rỗng trong danh sách = bỏ tên.
- Nhãn quần đảo (place=archipelago): giữ tên nếu tiếng Việt.
- Hoàng Sa, và Trường Sa ngoài vòng ta giữ: không giữ tên nào khác (đảo nước khác chiếm, cơ sở của họ).
- Trong vòng ta giữ: name = name:vi hoặc name, cái nào là tên tiếng Việt (la_ten_viet); không thì bỏ.
- Luôn bỏ mọi tag tên khác: name:* trừ name:vi, int_name, alt_name*, official_name*, old_name*… (int_name
  lọt vào name_int của tiles: "Northeast Cay", "Southwest Cay").
- Áp dụng cho node trong bbox, way có node trong bbox và relation chứa node/way đó (vị trí = node đầu tiên
  trong bbox của nó).

Vùng biển Đông mở rộng (DEVLOG 27/08/2026, quyết định phát sinh M1b T5): các núi ngầm/địa vật
mang tên chữ Hán nằm ngay ngoài hai bbox (ví dụ 111,3°E 11,4°N) lọt vào tile giao bbox. Trong
CJK_ZONE chỉ áp luật hẹp: name viết bằng chữ CJK mà không có name:vi → xoá name (có name:vi →
thay); xoá name:zh*. Tên Latin giữ nguyên. Vùng dừng ở 17,5°N để không chạm Hải Nam và phần đệm
biên giới phía bắc của extract (tên Trung Quốc ở đó là hợp lệ).
"""

import argparse
import json
import math
import pathlib
import re
import unicodedata

import osmium

BBOXES = [
    ("Hoàng Sa", 111.0, 15.7, 113.0, 17.2),
    ("Trường Sa", 111.5, 6.5, 117.8, 12.0),
]
CJK_ZONE = (102.0, 6.0, 117.8, 17.5)
CJK_DROP_KEYS = {"name:zh", "name:zh-Hans", "name:zh-Hant"}
# Viết bằng mã escape; gồm chữ tương thích U+F900–FAFF và mặt phẳng mở rộng (Ext-B…) như bên JS.
CJK_RE = re.compile("[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\U00020000-\U0003134f]")
CO_DAU_RE = re.compile("[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]", re.IGNORECASE)
PINYIN_RE = re.compile("[āǎēěīǐōǒūǔüǖǘǚǜ]", re.IGNORECASE)
PHU_AM_DAU = ["ngh", "ch", "gh", "gi", "kh", "ng", "nh", "ph", "qu", "th", "tr", "b", "c", "d", "đ",
              "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x", ""]
VAN = ["uyê", "uyu", "uya", "iêu", "yêu", "oai", "oay", "oao", "oeo", "uây", "uôi", "ươi", "ươu",
       "ai", "ao", "au", "ay", "âu", "ây", "eo", "êu", "ia", "iê", "iu", "oa", "oă", "oe", "oi", "ôi", "ơi",
       "ua", "uâ", "uê", "ui", "uô", "uơ", "uy", "ưa", "ưi", "ươ", "ưu", "yê",
       "a", "ă", "â", "e", "ê", "i", "o", "ô", "ơ", "u", "ư", "y"]
PHU_AM_CUOI = ["ch", "ng", "nh", "c", "m", "n", "p", "t", ""]
TACH_TU_RE = re.compile(r"[\s\-–—(),./:;\"'“”]+")
# Từ cấm (so sau khi bỏ dấu, nguyên từ) — cùng danh sách test dữ liệu POI.
TU_CAM = ["paracel", "spratly", "xisha", "nansha", "huangyan", "zhongsha", "sansha", "yongxing",
          "pag-asa", "pagasa", "kalayaan", "parola", "taiping", "layang", "tam sa", "vinh hung",
          "nam sa", "tay sa", "trung sa", "trung quoc", "trung hoa"]
TAG_TEN_RE = re.compile(r"^(name|alt_name|old_name|official_name|int_name|loc_name|short_name|reg_name|nat_name|sorting_name)(:|$)")
POLICY_DIR = pathlib.Path(__file__).resolve().parents[2] / "poi" / "data"


def bo_dau_thanh(s):
    """Bỏ dấu thanh (huyền, sắc, ngã, hỏi, nặng), giữ ă â ê ô ơ ư đ."""
    decomposed = unicodedata.normalize("NFD", s)
    return unicodedata.normalize("NFC", re.sub("[\u0300\u0301\u0303\u0309\u0323]", "", decomposed))


def gap(s):
    """Bỏ mọi dấu, đ → d, chữ thường — để so từ cấm."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.replace("đ", "d").replace("Đ", "d").lower()


def la_am_tiet(tu):
    w = bo_dau_thanh(tu.lower())
    for dau in PHU_AM_DAU:
        if not w.startswith(dau):
            continue
        con = w[len(dau):]
        if dau == "gi" and con == "":
            return True
        if any(con.startswith(van) and con[len(van):] in PHU_AM_CUOI for van in VAN):
            return True
    return False


def ten_an_toan(name):
    return bool(name) and not CJK_RE.search(name) and not PINYIN_RE.search(name)


def la_ten_viet(name):
    """Mọi từ là âm tiết tiếng Việt (hoặc số, chữ viết tắt in hoa), có dấu, không chữ Hán/pinyin — như laTenViet."""
    if not ten_an_toan(name) or not CO_DAU_RE.search(name):
        return False
    words = [w for w in TACH_TU_RE.split(name) if w]
    return bool(words) and all(
        w.isdigit() or re.fullmatch("[A-ZĐ]{1,6}", w) or la_am_tiet(w) for w in words
    )


def co_tu_cam(name):
    g = gap(name)
    return any(re.search(r"\b" + re.escape(w) + r"\b", g) for w in TU_CAM)


def doc_chinh_sach(policy_dir=POLICY_DIR):
    """Danh sách duyệt {"w123": tên} (tên rỗng = bỏ tên) và các vòng ta giữ [(lon, lat, bán kính m)]."""
    dao = {}
    lines = (policy_dir / "quan-dao-dao.csv").read_text(encoding="utf-8").strip().split("\n")
    for line in lines[1:]:
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split(",")
        dao[parts[0]] = parts[1] if len(parts) > 1 else ""
    cum = json.loads((policy_dir / "quan-dao-ta-giu.json").read_text(encoding="utf-8"))["cum"]
    return {"dao": dao, "ta_giu": [(c["lon"], c["lat"], c["banKinhM"]) for c in cum]}


def khoang_cach_m(lon1, lat1, lon2, lat2):
    r = math.pi / 180
    x = (lon2 - lon1) * r * math.cos((lat1 + lat2) / 2 * r)
    y = (lat2 - lat1) * r
    return math.hypot(x, y) * 6_371_000


def in_bboxes(lon, lat):
    return any(west <= lon <= east and south <= lat <= north for _, west, south, east, north in BBOXES)


def in_cjk_zone(lon, lat):
    west, south, east, north = CJK_ZONE
    return west <= lon <= east and south <= lat <= north


def has_cjk_name(tags):
    name = tags.get("name")
    return bool(name and CJK_RE.search(name))


def in_hoang_sa(lon, lat):
    _, west, south, east, north = BBOXES[0]
    return west <= lon <= east and south <= lat <= north


def patched_tags(tags, key=None, loc=None, policy=None):
    """Luật đầy đủ trong bbox. key "n1"/"w2"/"r3", loc (lon, lat) hoặc None. Trả dict tag mới, hoặc None."""
    policy = policy or {"dao": {}, "ta_giu": []}
    original = {tag.k: tag.v for tag in tags}
    result = {k: v for k, v in original.items() if not TAG_TEN_RE.match(k)}
    ten = None
    if key in policy["dao"]:
        ten = policy["dao"][key] or None
    elif original.get("place") == "archipelago":
        ten = next((t for t in (original.get("name:vi"), original.get("name")) if la_ten_viet(t or "")), None)
    elif loc is not None and not in_hoang_sa(*loc) and any(
        khoang_cach_m(loc[0], loc[1], lon, lat) <= r for lon, lat, r in policy["ta_giu"]
    ):
        ten = next((t for t in (original.get("name:vi"), original.get("name")) if la_ten_viet(t or "")), None)
    if ten and not co_tu_cam(ten):
        result["name"] = ten
        if "name:vi" in original or key in policy["dao"] or original.get("place") == "archipelago":
            result["name:vi"] = ten
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
    """Pass 1 (locations=True): node/way nào thuộc bbox đầy đủ (kèm vị trí), node/way nào thuộc vùng CJK."""

    def __init__(self):
        super().__init__()
        self.nodes = {}  # id -> (lon, lat)
        self.ways = {}  # id -> (lon, lat) của node đầu tiên trong bbox
        self.cjk_nodes = set()
        self.cjk_ways = set()

    def node(self, node):
        if not node.location.valid():
            return
        lon, lat = node.location.lon, node.location.lat
        if in_bboxes(lon, lat):
            self.nodes[node.id] = (lon, lat)
        elif in_cjk_zone(lon, lat) and has_cjk_name({tag.k: tag.v for tag in node.tags}):
            self.cjk_nodes.add(node.id)

    def way(self, way):
        for node in way.nodes:
            if node.ref in self.nodes:
                self.ways[way.id] = self.nodes[node.ref]
                return
        if not has_cjk_name({tag.k: tag.v for tag in way.tags}):
            return
        for node in way.nodes:
            if node.location.valid() and in_cjk_zone(node.location.lon, node.location.lat):
                self.cjk_ways.add(way.id)
                return


class Patcher(osmium.SimpleHandler):
    def __init__(self, writer, collector, policy):
        super().__init__()
        self.writer = writer
        self.c = collector
        self.policy = policy
        self.changed = 0

    def _emit(self, obj, add, key, loc, full, cjk):
        new_tags = None
        if full:
            new_tags = patched_tags(obj.tags, key, loc, self.policy)
        elif cjk:
            new_tags = cjk_patched_tags(obj.tags)
        if new_tags is not None:
            self.changed += 1
            add(obj.replace(tags=new_tags))
            return
        add(obj)

    def node(self, node):
        loc = self.c.nodes.get(node.id)
        self._emit(node, self.writer.add_node, f"n{node.id}", loc, loc is not None, node.id in self.c.cjk_nodes)

    def way(self, way):
        loc = self.c.ways.get(way.id)
        self._emit(way, self.writer.add_way, f"w{way.id}", loc, loc is not None, way.id in self.c.cjk_ways)

    def relation(self, relation):
        loc = None
        for member in relation.members:
            if member.type == "n" and member.ref in self.c.nodes:
                loc = self.c.nodes[member.ref]
            elif member.type == "w" and member.ref in self.c.ways:
                loc = self.c.ways[member.ref]
            if loc is not None:
                break
        self._emit(relation, self.writer.add_relation, f"r{relation.id}", loc, loc is not None, False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--policy-dir", default=str(POLICY_DIR), help="thư mục quan-dao-dao.csv / quan-dao-ta-giu.json")
    args = parser.parse_args()
    policy = doc_chinh_sach(pathlib.Path(args.policy_dir))

    collector = Collector()
    collector.apply_file(args.src, locations=True)
    writer = osmium.SimpleWriter(args.dst, overwrite=True)  # chạy lại data:update ghi đè bản patch cũ
    try:
        patcher = Patcher(writer, collector, policy)
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

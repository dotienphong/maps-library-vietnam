#!/usr/bin/env python3
"""Patch OSM trong hai bbox Hoàng Sa / Trường Sa trước khi build tiles.

- Có name:vi: đặt name = name:vi.
- Không có name:vi: xoá name để không hiển thị tên nước ngoài.
- Luôn xoá name:zh, name:zh-Hans, name:zh-Hant và name:en trong bbox.
- Áp dụng cho node trong bbox, way có node trong bbox và relation chứa node/way đó.
"""

import argparse

import osmium

BBOXES = [
    ("Hoàng Sa", 111.0, 15.7, 113.0, 17.2),
    ("Trường Sa", 111.5, 6.5, 117.8, 12.0),
]
DROP_KEYS = {"name:zh", "name:zh-Hans", "name:zh-Hant", "name:en"}


def in_bboxes(lon, lat):
    return any(west <= lon <= east and south <= lat <= north for _, west, south, east, north in BBOXES)


def patched_tags(tags):
    """Trả dict tag mới, hoặc None nếu không có gì cần đổi."""
    result = {tag.k: tag.v for tag in tags}
    if "name" not in result and not (DROP_KEYS & result.keys()):
        return None
    if "name:vi" in result:
        result["name"] = result["name:vi"]
    else:
        result.pop("name", None)
    for key in DROP_KEYS:
        result.pop(key, None)
    return result


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes = set()
        self.ways = set()

    def node(self, node):
        if node.location.valid() and in_bboxes(node.location.lon, node.location.lat):
            self.nodes.add(node.id)

    def way(self, way):
        if any(node.ref in self.nodes for node in way.nodes):
            self.ways.add(way.id)


class Patcher(osmium.SimpleHandler):
    def __init__(self, writer, nodes, ways):
        super().__init__()
        self.writer = writer
        self.nodes = nodes
        self.ways = ways
        self.changed = 0

    def _emit(self, obj, add, hit):
        if hit:
            new_tags = patched_tags(obj.tags)
            if new_tags is not None:
                self.changed += 1
                add(obj.replace(tags=new_tags))
                return
        add(obj)

    def node(self, node):
        self._emit(node, self.writer.add_node, node.id in self.nodes)

    def way(self, way):
        self._emit(way, self.writer.add_way, way.id in self.ways)

    def relation(self, relation):
        hit = any(
            (member.type == "n" and member.ref in self.nodes)
            or (member.type == "w" and member.ref in self.ways)
            for member in relation.members
        )
        self._emit(relation, self.writer.add_relation, hit)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src")
    parser.add_argument("dst")
    args = parser.parse_args()

    collector = Collector()
    collector.apply_file(args.src)
    writer = osmium.SimpleWriter(args.dst)
    try:
        patcher = Patcher(writer, collector.nodes, collector.ways)
        patcher.apply_file(args.src)
    finally:
        writer.close()
    print(
        f"patched objects: {patcher.changed}; "
        f"nodes in bbox: {len(collector.nodes)}; ways in bbox: {len(collector.ways)}"
    )


if __name__ == "__main__":
    main()

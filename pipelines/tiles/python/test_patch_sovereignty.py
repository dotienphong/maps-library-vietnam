import pathlib
import subprocess
import sys

import osmium
from osmium.osm import mutable

HERE = pathlib.Path(__file__).parent
SCRIPT = HERE / "patch_sovereignty.py"


def write_fixture(path):
    writer = osmium.SimpleWriter(str(path))
    writer.add_node(
        mutable.Node(
            id=1,
            location=(112.0, 16.5),
            tags={
                "place": "archipelago",
                "name": "Paracel Islands",
                "name:vi": "Quần đảo Hoàng Sa",
                "name:zh": "西沙群岛",
                "name:en": "Paracel Islands",
            },
        )
    )
    writer.add_node(
        mutable.Node(
            id=2,
            location=(114.36, 10.38),
            tags={"place": "island", "name": "Itu Aba Island"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=3,
            location=(106.7, 10.77),
            tags={
                "place": "city",
                "name": "Thành phố Hồ Chí Minh",
                "name:zh": "胡志明市",
            },
        )
    )
    # Vùng biển Đông ngoài hai bbox: tên chữ Hán bị bỏ, tên Latin giữ
    writer.add_node(
        mutable.Node(
            id=4,
            location=(111.34, 11.4),
            tags={"seamark:type": "sea_area", "name": "镜台海山", "name:zh": "镜台海山"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=5,
            location=(111.3, 11.41),
            tags={"natural": "reef", "name": "Bãi Tư Chính"},
        )
    )
    # Luật tên 26/09/2026 (PHONG): trong bbox giữ tên tiếng Việt dù thiếu name:vi (trước đây bị xoá, mất
    # 24 tên thật trên đảo ta giữ), xoá tên Latin nước ngoài, xoá chữ Hán và mọi name:* trừ name:vi.
    writer.add_node(
        mutable.Node(
            id=7,
            location=(114.331, 11.429),
            tags={"amenity": "place_of_worship", "name": "Chùa Song Tử Tây"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=8,
            location=(114.355, 11.453),
            tags={"man_made": "lighthouse", "name": "Parola Lighthouse", "name:tl": "Parola"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=9,
            location=(112.23, 8.876),
            tags={"place": "islet", "name": "西礁西岛", "name:ja": "西礁", "name:nan-Hant": "西礁"},
        )
    )
    # Phần đệm biên giới phía bắc (Quảng Tây, 22,2°N): ngoài vùng CJK → giữ nguyên
    writer.add_node(
        mutable.Node(
            id=6,
            location=(106.9, 22.2),
            tags={"leisure": "nature_reserve", "name": "花山国家级风景名胜区"},
        )
    )
    writer.add_way(
        mutable.Way(
            id=10,
            nodes=[2, 3],
            tags={"natural": "coastline", "name": "Itu Aba coast"},
        )
    )
    writer.add_way(
        mutable.Way(
            id=11,
            nodes=[4, 5],
            tags={"natural": "shoal", "name": "流春海山", "name:vi": "Bãi ngầm Lưu Xuân"},
        )
    )
    writer.close()


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.tags = {}

    def node(self, node):
        self.tags[("n", node.id)] = {tag.k: tag.v for tag in node.tags}

    def way(self, way):
        self.tags[("w", way.id)] = {tag.k: tag.v for tag in way.tags}


def test_patch(tmp_path):
    src = tmp_path / "in.osm.pbf"
    dst = tmp_path / "out.osm.pbf"
    write_fixture(src)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), str(dst)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    collected = Collect()
    collected.apply_file(str(dst))
    assert collected.tags[("n", 1)] == {
        "place": "archipelago",
        "name": "Quần đảo Hoàng Sa",
        "name:vi": "Quần đảo Hoàng Sa",
    }
    assert collected.tags[("n", 2)] == {"place": "island"}
    assert collected.tags[("n", 3)] == {
        "place": "city",
        "name": "Thành phố Hồ Chí Minh",
        "name:zh": "胡志明市",
    }
    assert collected.tags[("w", 10)] == {"natural": "coastline"}
    assert collected.tags[("n", 4)] == {"seamark:type": "sea_area"}
    assert collected.tags[("n", 5)] == {"natural": "reef", "name": "Bãi Tư Chính"}
    assert collected.tags[("n", 6)] == {
        "leisure": "nature_reserve",
        "name": "花山国家级风景名胜区",
    }
    assert collected.tags[("w", 11)] == {
        "natural": "shoal",
        "name": "Bãi ngầm Lưu Xuân",
        "name:vi": "Bãi ngầm Lưu Xuân",
    }
    assert collected.tags[("n", 7)] == {"amenity": "place_of_worship", "name": "Chùa Song Tử Tây"}
    assert collected.tags[("n", 8)] == {"man_made": "lighthouse"}
    assert collected.tags[("n", 9)] == {"place": "islet"}
    # n7 không đổi gì nên không tính là "patched".
    assert "patched objects: 7" in result.stdout

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
    # Chính sách chung với POI (pipelines/poi/data/quan-dao-*.{csv,json}): đảo trong danh sách duyệt lấy tên
    # Việt ghi đè (name:vi OSM ở đây thường là phiên âm tên TQ); ngoài vòng ta giữ không giữ tên cơ sở nào;
    # int_name/alt_name/official_name… (lọt vào name_int của tiles) bị bỏ.
    writer.add_node(
        mutable.Node(
            id=12,
            location=(114.355, 11.453),
            tags={
                "place": "islet",
                "name": "Parola Island",
                "name:vi": "Đảo Song Tử Đông",
                "int_name": "Northeast Cay",
                "alt_name": "Parola",
                "official_name:en": "Northeast Cay",
            },
        )
    )
    writer.add_node(
        mutable.Node(
            id=13,
            location=(112.27, 16.978),
            tags={"place": "islet", "name": "赵述岛", "name:vi": "Đảo Triệu Thuật"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=14,
            location=(112.34, 16.83),
            tags={"amenity": "townhall", "name": "三沙市人民政府", "name:vi": "Tòa Thị chính Thành phố Tam Sa"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=15,
            location=(114.0, 10.0),
            tags={"place": "archipelago", "name:vi": "Quần đảo Trường Sa", "name": "Spratly Islands"},
        )
    )
    writer.add_node(
        mutable.Node(
            id=16,
            location=(113.7084, 8.975),
            tags={"amenity": "place_of_worship", "name": "Chùa Vinh Phúc", "int_name": "Vinh Phuc Pagoda"},
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
    # n12: không có trong danh sách duyệt (danh sách ghi way w332539799) và ngoài vòng ta giữ → không tên.
    assert collected.tags[("n", 12)] == {"place": "islet"}
    # n13 Đảo Cây ở Hoàng Sa: name:vi là phiên âm TQ, không có trong danh sách → không tên.
    assert collected.tags[("n", 13)] == {"place": "islet"}
    assert collected.tags[("n", 14)] == {"amenity": "townhall"}
    # Nhãn quần đảo tiếng Việt giữ ở mọi nơi trong hai vùng.
    assert collected.tags[("n", 15)] == {
        "place": "archipelago",
        "name": "Quần đảo Trường Sa",
        "name:vi": "Quần đảo Trường Sa",
    }
    # Chùa Vinh Phúc (đảo Phan Vinh, ta giữ): chỉ dấu sắc/huyền nhưng mọi từ là âm tiết tiếng Việt → giữ.
    assert collected.tags[("n", 16)] == {"amenity": "place_of_worship", "name": "Chùa Vinh Phúc"}
    # n7 không đổi gì nên không tính là "patched".
    assert "patched objects: 12" in result.stdout


def test_la_ten_viet_cung_luat_voi_poi():
    # Cùng danh sách với pipelines/poi/tests/quan-dao.test.mjs (laTenViet).
    sys.path.insert(0, str(HERE))
    from patch_sovereignty import la_ten_viet

    for ten in [
        "Đảo Song Tử Tây",
        "Chùa Vinh Phúc",
        "Hòn Tháp",
        "UBND Thị trấn Trường Sa (cũ)",
        "Bia chủ quyền của VNCH năm 1956",
    ]:
        assert la_ten_viet(ten), ten
    for ten in [
        "Parola Lighthouse",
        "An Bang",
        "Nánshā Qúndǎo",
        "Tàipíng Dǎo",
        "Récif Discovery",
        "Đảo Pag-asa",
        "Đảo Layang Layang",
        "永兴岛",
        "Đảo 𠀀",
        "Đảo \uf900",
        "",
    ]:
        assert not la_ten_viet(ten), ten

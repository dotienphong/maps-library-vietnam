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
    writer.add_way(
        mutable.Way(
            id=10,
            nodes=[2, 3],
            tags={"natural": "coastline", "name": "Itu Aba coast"},
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
    assert "patched objects: 3" in result.stdout

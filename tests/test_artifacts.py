import hashlib
import re
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_HASHES = {
    "vulnerable_vault.sol": "ddc37d9ddf84e235478f96173344c535993fa8254c9fda6d77f35b432627d49f",
    "muxiang_sample_1_tx_attack_wallet.sol": "12ba37c01297563d131bb2f92dbb2c25b9be995eda4510b3ef6d83a13c73c33a",
    "muxiang_sample_2_delegatecall_proxy.sol": "63c7c25c4d80ce5546ee3d641754365cad88e96564cd494c24dec0a13be08c80",
    "muxiang_sample_3_weak_randomness.sol": "601ddea7be4ac4f5fb948cd1259751d45b3c379a0bed4e1bf8cba5eac9a5a17b",
    "muxiang_sample_4_odd_even.sol": "1725183f90dfbd2aa17825a0c3aef90e9d248ed1041d63142a7594021bac8938",
}


@pytest.mark.parametrize("filename", ORIGINAL_HASHES)
def test_original_fixture_bytes_preserved(filename):
    data = (ROOT / "contracts/fixtures/originals" / filename).read_bytes()
    assert hashlib.sha256(data).hexdigest() == ORIGINAL_HASHES[filename]


def test_pip_export_matches_uv_lock_versions():
    lock = tomllib.loads((ROOT / "uv.lock").read_text())
    locked = {
        (item["name"], item["version"]) for item in lock["package"] if "registry" in item["source"]
    }
    exported = set(
        re.findall(
            r"^([a-zA-Z0-9_.-]+)==([^\s;]+)",
            (ROOT / "requirements-dev.lock").read_text(),
            re.MULTILINE,
        )
    )
    assert exported == locked, "Regenerate requirements-dev.lock after changing uv.lock"

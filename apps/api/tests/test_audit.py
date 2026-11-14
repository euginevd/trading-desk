import json
import threading
from pathlib import Path

from api.audit import Audit


def test_lines_from_many_threads_all_land(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")

    def write(n: int) -> None:
        for i in range(50):
            audit.record("bot", f"thread {n}", str(i))

    threads = [threading.Thread(target=write, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 400
    assert all(json.loads(line)["asked_by"] == "owner" for line in lines)

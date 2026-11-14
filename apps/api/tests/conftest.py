from collections.abc import Iterator

import pytest
from api import tao


@pytest.fixture(autouse=True)
def fresh_tao_readings() -> Iterator[None]:
    """Each test starts with no kept TAO wallet reading."""
    tao.forget()
    yield
    tao.forget()

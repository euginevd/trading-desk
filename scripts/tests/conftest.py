"""Loads the report scripts, whose hyphenated names can't be imported the usual way."""

import importlib.util
import pathlib
from types import ModuleType

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def security() -> ModuleType:
    return load("security-report")


@pytest.fixture(scope="session")
def cost() -> ModuleType:
    return load("cost-report")

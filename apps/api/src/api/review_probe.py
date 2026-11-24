"""A test of Claude's PR review (decision 103). Not for merging."""

from decimal import Decimal


def split_evenly(total: Decimal, parts: int) -> list[Decimal]:
    """A total split into equal shares, as for a weekly buy across coins."""
    share = total / parts
    return [round(share, 2)] * parts

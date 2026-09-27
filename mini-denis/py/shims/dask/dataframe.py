"""Minimal in-memory stand-in for ``dask.dataframe``, used by clstools in the browser.

clstools wraps a run's event table in a dask DataFrame, does column arithmetic and
groupby aggregations on it, and calls ``.compute()`` to get pandas results. In the
browser (Pyodide) everything already lives in memory and runs on one thread, so a
pandas DataFrame whose objects also answer ``.compute()`` behaves identically and is
faster than real dask.
"""
import numpy as np
import pandas as pd

__all__ = ["DataFrame", "Series", "from_pandas", "from_array"]


class _ScalarF(float):
    """Result of a reduction (``.mean()``, ``.min()`` ...); ``.compute()`` gives the value."""
    def compute(self):
        return float(self)


class _ScalarI(int):
    def compute(self):
        return int(self)


def _wrap(value):
    if isinstance(value, (pd.DataFrame, pd.Series)):
        return value
    if isinstance(value, (bool, np.bool_)):
        return value
    if isinstance(value, (int, np.integer)):
        return _ScalarI(value)
    if isinstance(value, (float, np.floating)):
        return _ScalarF(value)
    return value


class Series(pd.Series):
    @property
    def _constructor(self):
        return Series

    @property
    def _constructor_expanddim(self):
        return DataFrame

    def compute(self):
        return pd.Series(self)

    def persist(self):
        return self

    # reductions return scalars that also have .compute()
    def mean(self, *a, **k): return _wrap(super().mean(*a, **k))
    def min(self, *a, **k): return _wrap(super().min(*a, **k))
    def max(self, *a, **k): return _wrap(super().max(*a, **k))
    def sum(self, *a, **k): return _wrap(super().sum(*a, **k))
    def std(self, *a, **k): return _wrap(super().std(*a, **k))
    def median(self, *a, **k): return _wrap(super().median(*a, **k))
    def count(self, *a, **k): return _wrap(super().count(*a, **k))
    def nunique(self, *a, **k): return _wrap(super().nunique(*a, **k))


class DataFrame(pd.DataFrame):
    @property
    def _constructor(self):
        return DataFrame

    @property
    def _constructor_sliced(self):
        return Series

    def compute(self):
        return pd.DataFrame(self)

    def persist(self):
        return self

    @property
    def npartitions(self):
        return 1


def from_pandas(data, npartitions=None, chunksize=None, sort=True, **kwargs):
    if isinstance(data, pd.Series):
        return Series(data)
    return DataFrame(data)


def from_array(x, chunksize=None, columns=None, meta=None, **kwargs):
    return DataFrame(np.asarray(x), columns=columns)

"""Minimal ``PySide6.QtCore`` for the browser build of DENIS.

DENIS's ``gui/calibration.py`` and ``gui/scan_filter.py`` only use Qt for a
change-notification signal on their registries (``QObject`` + ``Signal``).
Everything else in them is plain numpy, so this stand-in lets the unmodified
modules run in Pyodide.
"""


class _BoundSignal:
    def __init__(self):
        self._slots = []

    def connect(self, slot):
        self._slots.append(slot)

    def disconnect(self, slot=None):
        if slot is None:
            self._slots.clear()
        elif slot in self._slots:
            self._slots.remove(slot)

    def emit(self, *args):
        for slot in list(self._slots):
            slot(*args)


class Signal:
    """Descriptor: each instance gets its own connectable signal."""

    def __init__(self, *types, **kwargs):
        self._name = None

    def __set_name__(self, owner, name):
        self._name = "_signal_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        sig = obj.__dict__.get(self._name)
        if sig is None:
            sig = obj.__dict__[self._name] = _BoundSignal()
        return sig


class QObject:
    def __init__(self, parent=None, *args, **kwargs):
        pass


Slot = lambda *a, **k: (lambda f: f)   # noqa: E731  (decorator no-op)

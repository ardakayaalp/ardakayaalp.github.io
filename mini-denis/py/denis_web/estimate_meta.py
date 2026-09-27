"""Light helpers for the Estimate form (available as soon as the core engine is up).

Element table, AME masses and Schmidt moments come from the DENIS modules the desktop
form uses (cls_estimations.mass_lookup / schmidt); nothing here needs satlas2 or matplotlib.
"""
from cls_estimations import mass_lookup, schmidt

_table = None


def meta():
    """Element symbols <-> Z and the Schmidt orbital names, for the form's dropdowns."""
    return {"element_z": dict(mass_lookup.ELEMENT_Z),
            "orbitals": [o["name"] for o in schmidt.ORBITALS]}


def mass(Z, A):
    """AME mass in amu (the table cls_estimate uses), or None when not in the table."""
    global _table
    if _table is None:
        _table = mass_lookup.load_mass_table()
    try:
        return float(mass_lookup.get_mass(_table, int(Z), int(A)))
    except Exception:
        return None


def schmidt_mu(spec):
    """Unquenched Schmidt moment (g_s = 1) the desktop form auto-fills into mu."""
    try:
        mu, desc = schmidt.calculate_schmidt_moment(dict(spec), g_s_factor=1.0)
        return {"mu": float(mu), "desc": desc}
    except Exception as exc:
        return {"error": str(exc)}

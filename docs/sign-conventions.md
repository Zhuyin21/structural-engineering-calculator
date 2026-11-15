# Sign conventions

## Axes

Right-handed. **x** runs along the beam from its left end, **y** is up, and
**z** comes toward you when you look at the XY plane.

| View | Horizontal | Vertical | You are looking along |
|------|------------|----------|-----------------------|
| XY plane | x to the right | y up | −z |
| XZ plane | x to the right | z up | +y |

## What you enter

| Quantity | Positive when |
|----------|---------------|
| Fx, Fy, Fz | it acts along +x, +y, +z. A downward load is a negative Fy. |
| T (torque) | its vector points along +x (right-hand rule). |
| Mz | counter-clockwise in the XY view (right-hand rule about +z). |
| My | right-hand rule about +y. This is **clockwise** in the XZ view. |
| Distributed loads | same as the force or torque they are made of, per unit length. |

## What you get back

| Quantity | Meaning and sign |
|----------|------------------|
| Reactions | forces and moments the supports apply to the beam, in the axes above. |
| N | axial force, positive in tension. |
| Vy, Vz | sum of the transverse forces to the left of the cut. A simply supported beam under downward load starts with positive shear. |
| Mz | bending moment in the XY plane, positive when the beam sags in that view (concave toward +y, tension on the −y side). |
| My | bending moment in the XZ plane, positive when the beam sags in that view (concave toward +z). |
| Total bending moment | √(Mz² + My²). The right quantity for round sections. |
| T | internal torque, positive when the torque vector on a cut face that looks toward +x points along +x. Fix the left end and apply +T at the right end: the internal torque is +T. |
| dv/dx, dw/dx | slopes of the deflected shape in each plane. |
| v, w, u | deflection along +y, +z and +x. |
| φ | angle of twist, right-hand rule about +x. |

With these conventions dV/dx = w and dM/dx = V in each plane, where w is the
distributed load along +y or +z. A counter-clockwise couple (as seen in the
plane view) makes the moment diagram drop by its value.

### A note on My

The diagram value "My" is reported with the same sagging-positive rule as
Mz, so the two plane views read alike. It is therefore the bending moment in
the XZ plane, not the vector component of the internal moment about +y,
which has the opposite sign. Applied moments and reaction moments, by
contrast, are true vector components.

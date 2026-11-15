# Sign conventions

## Axes

Right-handed. **x** runs along the beam from its left end, **y** is up, and
**z** comes toward you when you look at the XY plane.

| View | Horizontal | Vertical | You are looking along |
|------|------------|----------|-----------------------|
| XY plane (front view) | x to the right | y up | −z |
| XZ plane (top view) | x to the right | z **down** | −y |

## What you enter

| Quantity | Positive when |
|----------|---------------|
| Fx, Fy, Fz | it acts along +x, +y, +z. A downward load is a negative Fy. |
| T (torque) | its vector points along +x (right-hand rule). |
| Mz | counter-clockwise in the XY view (right-hand rule about +z). |
| My | counter-clockwise in the XZ view (right-hand rule about +y). |
| Distributed loads | same as the force or torque they are made of, per unit length. |

## What you get back

| Quantity | Meaning and sign |
|----------|------------------|
| Reactions | forces and moments the supports apply to the beam, in the axes above. |
| N | axial force, positive in tension. |
| Vy, Vz | positive when the forces to the left of the cut add up to a resultant pointing up the page: Vy = +ΣFy, Vz = −ΣFz. A simply supported beam under a load that points down the page starts with positive shear, in either view. |
| Mz | bending moment in the XY plane, positive when the beam sags on the page (concave toward +y, tension on the −y side). |
| My | bending moment in the XZ plane, positive when the beam sags on the page (concave toward −z, tension on the +z side). |
| Total bending moment | √(Mz² + My²). The right quantity for round sections. |
| T | internal torque, positive when the torque vector on a cut face that looks toward +x points along +x. Fix the left end and apply +T at the right end: the internal torque is +T. |
| dv/dx, dw/dx | slopes of the deflected shape in each plane. |
| v, w, u | deflection along +y, +z and +x. In the XZ tab, w and dw/dx are plotted with positive values downward, to match the view. |
| φ | angle of twist, right-hand rule about +x. |

Both planes follow one rule, stated on the page: shear is positive when the
left-hand resultant points up the page, and moment is positive when the beam
sags on the page. Mz and My are then exactly the right-hand-rule components
of the internal moment on a cut face that looks toward +x, so applied
moments, reaction moments and the diagrams all use the same sign.

In each view dV/dx = w and dM/dx = V, where w is the distributed load
measured up the page (+y in XY, −z in XZ). A counter-clockwise couple makes
the moment diagram drop by its value.

## Shaft

The shaft analysis uses the same axes, views and signs as the beam. A torque
T on a component is positive by the right-hand rule about +x; the torque
diagram shows the internal torque on a cut face that looks toward +x, so a
positive applied torque makes the diagram drop by its value. The total
bending moment M = sqrt(My^2 + Mz^2), the total slope and the total
deflection combine the two planes as vectors and are never negative.

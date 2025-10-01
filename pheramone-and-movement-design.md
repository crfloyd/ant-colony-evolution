
# Ant Colony Pheramon and Movement Redesign

# 1) Use distance-based deposits + bilinear “splat”

**Goal:** avoid 20-unit cell stair-steps and frame-rate artifacts.

* Set deposit spacing: `d_dep = 5–6 units` (≈3–4 drops per cell at straight motion).
* Deposit **per unit distance**, not per drop:

  * Scouts (homePher): `strength_per_unit ≈ 0.05`
  * Foragers returning (foodPher): `≈ 0.10–0.12`
* **Bilinear splat** the drop into the 4 surrounding cells based on the fractional position within the cell (prevents “same cell until 21u then jump”):

```ts
function splat(grid, x, y, amount) {
  const gx = x / CELL, gy = y / CELL;
  const i = Math.floor(gx), j = Math.floor(gy);
  const fx = gx - i, fy = gy - j;
  const w00 = (1-fx)*(1-fy), w10 = fx*(1-fy), w01 = (1-fx)*fy, w11 = fx*fy;
  grid[j][i]     += amount * w00;
  grid[j][i+1]   += amount * w10;
  grid[j+1][i]   += amount * w01;
  grid[j+1][i+1] += amount * w11;
}
```

Keep an `accumDist` per ant:

```ts
accum += distanceMoved;
while (accum >= d_dep) {
  const p = interpolate(prevPos, pos, (accum - d_dep)/distanceMoved);
  const amt = strength_per_unit * d_dep;   // constant per meter
  splat(layer, p.x, p.y, amt);
  accum -= d_dep;
}
```

Also remove the “> 400u from nest” gate; if you really want tapering, fade by radius, don’t hard-gate.

---

# 2) Fix decay & diffusion (20 Hz update)

Use half-lives → per-update decay ρ:

* `homePher` T½ ≈ **45 s** → `ρ ≈ 0.00154`
* `foodPher` T½ ≈ **20 s** → `ρ ≈ 0.00347`
* Diffusion: **tiny**

  * `D_home = 0.01`
  * `D_food = 0.02`
    Order: **evaporate then diffuse**.

```ts
cell *= (1 - rho);
cell = (1 - D)*cell + D*avg4(neighbors);
```

(Your old `ρ=0.02` and `D=0.10` were obliterating trails.)

---

# 3) Compute real gradients (keep magnitude!)

Current `(right-left)` then **normalize** loses strength info. With `CELL = 20`, do one of:

### A) Centered difference (cheap)

[
g_x = \frac{R - L}{2,CELL}, \quad g_y = \frac{B - T}{2,CELL}
]
Compute **`(gx, gy)`** and **don’t** normalize; use magnitude downstream.

### B) Sobel (better orientation, includes diagonals)

Precompute per tick via 3×3 convolution (fast at 400×400):

```
Gx kernel = [[ 1, 0,-1],
             [ 2, 0,-2],
             [ 1, 0,-1]] / (8*CELL)

Gy kernel = [[ 1, 2, 1],
             [ 0, 0, 0],
             [-1,-2,-1]] / (8*CELL)
```

(Use Scharr if you want even better isotropy; scale by 1/(32*CELL).)

**Sampling at ant position:** build `gxGrid`, `gyGrid`, then **bilinear interpolate** them at the ant’s world position (same splat math but read instead of write). That gives smooth, subcell gradients.

---

# 4) Steer with gradient **magnitude-aware** logic

* Let `g = (gx,gy)` at the ant’s position; `m = |g|`.
* Convert to a steering weight (soft threshold so tiny noise doesn’t dominate):

```ts
const mEff = clamp01((m - G0) / Gspan);   // e.g., G0≈0.001, Gspan≈0.01 (units: pheromone per unit distance)
const desired = normalize(g);
const blended = normalize( (1-α)*heading + α*mEff*desired ); // α≈0.5
heading = turnClamp(heading, blended, maxTurnPerTick);
```

Or, if you pick among K candidate headings, use a softmax with score `β * (g · u_k)` and let `β = β0 * m`.

---

# 5) Sensible caps & thresholds

* Sense threshold: about **1–2%** of a fresh per-cell drop. With the above numbers a fresh 5u drop is ~**0.25**, so sense at **0.003–0.01**; render slightly higher to de-noise.
* Cap per cell (e.g., 10). Zero out tiny values `<1e-5` to avoid flicker.

---

# 6) Numbers checked against your grid

* Ants cross **6.67 cells/s**; with `d_dep=5u` you place **~36 drops/s** → ~**1.8 units** of pheromone per second for scouts (0.05*36) and **~3.6–4.3** for returning foragers → trails strengthen faster than they evaporate.
* Centered difference uses `2*CELL = 40` in the denominator; a step of `Δ=0.25` across a cell boundary yields `|g|≈0.00625`. Set `G0≈0.001` and `Gspan≈0.01` to make that clearly influential but not saturating.

---

# 7) Optional polish (cheap and effective)

* **Subcell read smoothing:** when sampling raw grid (not gradient), use bilinear interpolation too, so ants see smooth concentrations, not blocky steps.
* **Role-specific σ:** make paver/carrier deposits slightly wider (splat to an extra ring with small weights) to form “corridors”; scouts keep narrow splats.
* **Precompute gradients after each layer update** once per tick (per layer). 400×400×9 MACs/tick × 20 Hz is trivial on CPU.

---

# Compact drop-ins

**Gradient (centered difference) at integer cell**:

```ts
const inv2dx = 1 / (2 * CELL);
gx[i][j] = (grid[j][i+1] - grid[j][i-1]) * inv2dx;
gy[i][j] = (grid[j+1][i] - grid[j-1][i]) * inv2dx;
```

**Sample gradient at world pos**:

```ts
function sampleVec(gx, gy, x, y) {
  // bilinear interpolate gx and gy separately
  const Gx = bilinear(gx, x/CELL, y/CELL);
  const Gy = bilinear(gy, x/CELL, y/CELL);
  return { x: Gx, y: Gy };
}
```

**Steer**:

```ts
const g = sampleVec(gxGrid, gyGrid, ant.x, ant.y);
const m = Math.hypot(g.x, g.y);
const mEff = clamp01((m - 0.001) / 0.01);
const desired = normalize(g);
ant.heading = blendTurn(ant.heading, desired, alpha=0.5*mEff, maxTurn=deg2rad(12));
```

---

## TL;DR

* Deposit by **distance** with **bilinear splat** (d=5–6u).
* Evaporation **ρ≈0.0015/0.0035** (home/food), diffusion **1–2%**.
* Compute **true gradients** (centered or Sobel) and **don’t normalize**; sample with bilinear interpolation.
* Steer using a **magnitude-aware** weight so strong trails pull harder.

If you paste your update/deposit/gradient functions, I’ll return an exact patch with these constants dropped in for your codebase.

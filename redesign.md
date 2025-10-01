Here are practical, bite-sized upgrades that will make the sim feel smarter

# Quick wins

* **Two pheromone fields:** `foodPher` (laid while returning) and `homePher` (laid while leaving). Ants follow the *other* gradient depending on state—this stabilizes trails and prevents loops.
* **Probabilistic turning:** When foraging, sample headings with probability ∝ pheromone gradient (softmax over a few candidate headings) + small noise. This avoids laser-straight bee-lines and makes exploration robust.
* **Evaporation + diffusion:** Each tick on a grid:

  * `grid *= (1 - rho)` (evaporation, e.g., `rho = 0.01–0.05`)
  * `grid = (1 - D)*grid + D*avg(neighbors)` (diffusion, e.g., `D = 0.1`)
    Produces smooth trails that fade if unused.
* **Simple FOV sensing:** Cast 3 rays (left/center/right) a short distance; pick next heading by weighted vote from (pheromone, food sighting, obstacle distance).
* **Ant state machine (tiny):** `Foraging → Returning → (Drop at colony) → Foraging`. Keep 2–3 bytes of memory: last heading, last found food pos, time since last food.

# Behavior details

* **Foraging step:**

  1. Sense `homePher` gradient and food in FOV.
  2. If food in reach: take chunk (min(foodLeft, carryCap)), switch to Returning, cache `sourceId`.
  3. Else choose heading by:
     `heading = argmax( w_pher * grad(homePher) + w_rand * noise + w_wall * tangent )`
     `w_pher~0.6, w_rand~0.3, w_wall~0.1`. Tangent helps slide along obstacles.
* **Returning step:**

  1. Drop `foodPher` at current cell: `grid += depositAmount` (cap cell max).
  2. Follow **home vector**: if you keep a breadcrumb of last few headings, bias to their negative; otherwise follow `homePher` gradient if you lay `homePher` on leaving.
  3. On deposit at colony, increment colony food; if ≥ threshold, spawn.

# Food & carrying

* **Carrying capacity:** e.g., 1–3 units per trip; food piles deplete over multiple ants → natural traffic on good sources.
* **Regrowth:** When respawning, bias new food away from existing trails (sample rejection on high `foodPher`) so the map keeps evolving.

# Trail robustness

* **Trail decay gates:** Only deposit when carrying, and only every `k` steps (e.g., every 3–5) to reduce noise.
* **Trail reinforcement:** Foragers may deposit *weak* `homePher` “I came from colony” every `m` steps so scouts help bootstrap routes.

# World model & perf

* **Grid vs continuous:** Keep movement continuous, but store pheromones on a uniform grid (float32). Use a uniform spatial hash for collisions & ray hits—cheap and parallelizable.
* **Obstacles:** Keep as signed-distance functions or AABBs; steering uses simple “obstacle avoidance vector” = sum of repulsions from nearby walls.
* **Tuning ranges:**

  * `rho (evap)`: 0.01–0.05 per tick
  * `D (diffuse)`: 0.05–0.2
  * `deposit`: 0.5–2.0 per drop (cap per cell, e.g., 10)
  * `vision`: 4–8× ant radius; 3–5 rays
  * `wander noise`: ±5–15° per step

# Reproduction & economy

* **Spawn rules:** Cost-based spawning prevents runaway growth: require `spawnCost` food (e.g., 20) and **deduct it**; optionally increase cost slightly per ant to model upkeep.
* **Energy:** Ants lose a drip of energy; returning to colony or eating increments it. Starved ants die → dynamic population control.

# Metrics & debugging

* Track: trips/hour, average trip length, % time foraging vs returning, food throughput, live ant count, mean trail lifetime.
* Overlays: show pheromone heatmaps (two toggles), FOV rays, chosen heading, and per-cell vector field (sparse arrows).

# Experiments to try

1. **Lévy walk** for scouts: power-law step lengths until first pheromone pickup → faster discovery in sparse maps.
2. **Bottlenecks:** Add narrow passages and watch trails self-organize; tune `D` to avoid trail “bleed” through walls.
3. **Multiple colonies (competition):** Each colony uses its own `foodPher` field; see territorial trail formation.
4. **A* only at the end:** Keep your local steering; when within `r` of colony, do a short A* on a coarse grid to avoid last-meter dithering.

# Minimal pseudocode drop-ins

**Pheromone update (per tick):**

```pseudo
for each cell:
  foodPher[c]  = (1 - rho)*foodPher[c]  + D * avgNeighbor(foodPher, c)
  homePher[c]  = (1 - rho)*homePher[c]  + D * avgNeighbor(homePher, c)
```

**Ant step (forager):**

```pseudo
rays = sample_rays(pos, heading, fov=60°, n=3, dist=vision)
scores = []
for ray in rays:
  g = gradient(homePher, ray.end)              # “away from home”
  obst = obstacle_repulsion(ray)               # steer off walls
  s = w_pher*dot(dir(ray), normalize(g)) + w_wall*obst + w_rand*randn()
  scores.append(s)
heading = direction_of_argmax(scores)
pos += speed * dir(heading)
maybe_deposit(homePher, weak=true, every=5)
```

**Ant step (returning):**

```pseudo
deposit(foodPher, pos, amount)
home_vec = normalize(colony_pos - pos)
g = gradient(homePher, pos)                     # optional if you lay homePher
dir_choice = normalize( α*home_vec + β*g + γ*avoid_obstacles(pos) )
heading = blend(heading, dir_choice, 0.5)
pos += speed * dir(heading)
if at_colony: drop_food(); state=Foraging
```

# Polishing touches

* **Traffic smoothing:** Slightly slow ants when local ant density is high (cheap boids-style separation). Prevents clogging in corridors.
* **Trail “locks”:** If an ant has followed the same trail for `t` seconds without food at the end, it flips to scout mode and ignores pheromones for a cooldown—prevents dead-end herding.
* **Replay seed & presets:** Add a seed and a small preset menu (Sparse/Windy/Claustrophobic) to quickly compare parameter sets.

// Fixed-timestep clock. Time is advanced in whole ticks, with no wall-clock access.

const SEASONS = ['primavera', 'verano', 'otoño', 'invierno'];
const DAYS_PER_SEASON = 30;

export function createClock(opts = {}) {
  const ticksPerDay = opts.ticksPerDay ?? 24;
  const msPerTick = opts.msPerTick ?? 400;
  const maxTicksPerAdvance = opts.maxTicksPerAdvance ?? 24;
  let tick = opts.tick ?? 0;
  let accumulatorMs = 0;

  return {
    advance(dtMs, speed) {
      accumulatorMs += dtMs * speed;
      let ticks = Math.floor(accumulatorMs / msPerTick);
      if (ticks > maxTicksPerAdvance) {
        // Discard the excess so a long pause does not defer the freeze to the next frame.
        ticks = maxTicksPerAdvance;
        accumulatorMs = 0;
      } else {
        accumulatorMs -= ticks * msPerTick;
      }
      tick += ticks;
      return ticks;
    },
    get tick() {
      return tick;
    },
    get day() {
      return Math.floor(tick / ticksPerDay);
    },
    get hour() {
      return tick % ticksPerDay;
    },
    get season() {
      return SEASONS[Math.floor(this.day / DAYS_PER_SEASON) % SEASONS.length];
    },
  };
}

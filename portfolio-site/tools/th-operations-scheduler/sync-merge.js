/* Three-way reconciliation: retain remote changes except where this device
   edited the same value. Assignment cells are atomic to avoid mixed shifts. */
(() => {
  "use strict";
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const keyed = (values) => values.every((value) => object(value) && value.id != null) &&
    new Set(values.map((value) => value.id)).size === values.length;
  const merge = (base, local, remote) => {
    if (equal(local, base)) return remote;
    if (equal(remote, base) || equal(local, remote)) return local;
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
      if ([base, local, remote].every(keyed)) {
        const b = new Map(base.map((v) => [v.id, v]));
        const l = new Map(local.map((v) => [v.id, v]));
        const r = new Map(remote.map((v) => [v.id, v]));
        const orderChanged = !equal(base.filter((v) => l.has(v.id)).map((v) => v.id),
          local.filter((v) => b.has(v.id)).map((v) => v.id));
        const order = orderChanged ? [...l.keys(), ...r.keys()] : [...r.keys(), ...l.keys()];
        return [...new Set(order)].map((id) => merge(b.get(id), l.get(id), r.get(id)))
          .filter((v) => v !== undefined);
      }
      if ([...base, ...local, ...remote].every((v) => typeof v === "string")) {
        return [...new Set([...remote.filter((v) => !base.includes(v) || local.includes(v)),
          ...local.filter((v) => !base.includes(v))])];
      }
      return local;
    }
    if (object(local) && object(remote) && (base === undefined || object(base))) {
      if ("status" in local || "status" in remote) return local;
      const result = {};
      for (const key of new Set([...Object.keys(base || {}), ...Object.keys(remote), ...Object.keys(local)])) {
        const value = merge(base?.[key], local[key], remote[key]);
        if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    return local;
  };
  globalThis.SchedulerSync = { merge };
})();

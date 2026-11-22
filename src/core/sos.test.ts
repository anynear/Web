import { describe, expect, it } from "vitest";
import type { AnmpCoreWeb } from "anmp-core";
import {
  careSos,
  refreshSosCalls,
  setSosHelpers,
  sosCalls,
  sosHelpers,
  startSos,
  switchOffSos,
} from "./sos";

/** Lets the setting that `startSos` loads arrive first, as in the app after the start. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const list = <T>(items: T[]) => ({ asJsReadonlyArrayView: () => items });

/** A core with the calls and SOS contacts the tests need; records what the web app asked of it. */
function fakeCore(calls: () => object[]) {
  const log: string[] = [];
  const core = {
    sosCalls: () => calls(),
    careSos: async (id: string) => {
      log.push(`care:${id}`);
      return true;
    },
    sosAsks: () => [],
    sosAgreed: () => [],
    sosContacts: () => [],
    setting: async () => null,
    setSetting: async (k: string, v: string) => {
      log.push(`set:${k}=${v}`);
    },
    askSosContacts: async (c: string[], p: string[]) => {
      log.push(`ask:${c.join("+")}|${p.join("+")}`);
      return true;
    },
    endSosContact: async (p: string) => {
      log.push(`end:${p}`);
      return true;
    },
  };
  return { core: core as unknown as AnmpCoreWeb, log };
}

const call = (over: object = {}) => ({
  id: "c1",
  owner: "pia",
  own: false,
  start: BigInt(1_800_000_000_000),
  ended: false,
  position: {
    latitude: 50.2213,
    longitude: 8.2683,
    at: BigInt(1_800_000_060_000),
    accuracy: 12,
  },
  battery: 64,
  caring: list<string>([]),
  plan: null,
  ...over,
});

describe("SOS-Rufe im Browser (22.11.2026)", () => {
  it("zeigt den Ruf mit genauem Ort, Akku und wer sich kümmert", () => {
    const { core } = fakeCore(() => [call({ caring: list(["ben"]) })]);
    startSos(core);
    const [c] = sosCalls.value;
    expect(c.owner).toBe("pia");
    expect(c.place).toEqual({
      latitude: 50.2213,
      longitude: 8.2683,
      at: 1_800_000_060_000,
      accuracy: 12,
    });
    expect(c.battery).toBe(64);
    expect(c.caring).toEqual(["ben"]);
    expect(c.fromCheckIn).toBe(false);
  });

  it("kennt einen Ruf ohne Standort und einen aus einem Lebenszeichen", () => {
    const { core } = fakeCore(() => [call({ position: null, plan: "plan-1" })]);
    startSos(core);
    expect(sosCalls.value[0].place).toBeNull();
    expect(sosCalls.value[0].fromCheckIn).toBe(true);
  });

  it("„Ich kümmere mich“ geht an den Kern", async () => {
    const { core, log } = fakeCore(() => [call()]);
    startSos(core);
    expect(await careSos("c1")).toBe(true);
    expect(log).toContain("care:c1");
  });

  it("ein älterer Kern ohne Rufe zeigt nichts und bricht nicht", () => {
    const { core } = fakeCore(() => {
      throw new TypeError("sosCalls is not a function");
    });
    sosCalls.value = [];
    startSos(core);
    refreshSosCalls();
    expect(sosCalls.value).toEqual([]);
  });
});

describe("SOS ausschalten (22.11.2026)", () => {
  it("nimmt alle SOS-Kontakte heraus, und sie erfahren es", async () => {
    const { core, log } = fakeCore(() => []);
    startSos(core);
    await settle();
    await setSosHelpers({ circles: [], persons: ["anna", "ben"], except: [] });
    log.length = 0;
    expect(await switchOffSos()).toBe(true);
    expect(sosHelpers.value).toEqual({ circles: [], persons: [], except: [] });
    expect(log).toContain("set:kv:sos.helpers=0");
    expect(log).toContain("end:anna");
    expect(log).toContain("end:ben");
  });

  it("lässt einen eigenen laufenden Ruf stehen; der endet am Handy mit „Alles gut“", async () => {
    const { core } = fakeCore(() => [call({ own: true, owner: "ich" })]);
    startSos(core);
    await settle();
    await setSosHelpers({ circles: [], persons: ["anna"], except: [] });
    expect(await switchOffSos()).toBe(false);
    expect(sosHelpers.value.persons).toEqual(["anna"]);
  });
});

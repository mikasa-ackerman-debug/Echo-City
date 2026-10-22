"use client";
import { ARK, DISTRICT_FLAVOR } from "@echo/engine";
import { SuitMark } from "./card";

export interface MapVenue { district: string; status: "lit" | "running" | "done" | "dark"; registered?: number; capacity?: number; card?: string }

/**
 * City map (§6.2): the engine's 3×4 grid (city.ts buildCity), Ark fixed at bottom-right.
 * Lit venues show a "?" until their card is revealed; my agent is the one ember point.
 */
export function CityMap({ districts, venues = [], people = {}, mine = [], onPick, selected }: {
  districts: string[];
  venues?: MapVenue[];
  /** district → names present */
  people?: Record<string, string[]>;
  mine?: string[];
  onPick?: (district: string) => void;
  selected?: string;
}) {
  const list = districts.length ? districts : Array.from({ length: 12 }, (_, i) => (i === 11 ? ARK : `街区 ${i + 1}`));
  return (
    <div className="citymap" role="list" aria-label="城市地图">
      {list.map((d, i) => {
        const v = venues.find((x) => x.district === d);
        const here = people[d] ?? [];
        const mineHere = here.some((n) => mine.includes(n));
        const ark = d === ARK;
        const cls = ["citymap__cell", v ? `citymap__cell--${v.status}` : "", ark ? "citymap__cell--ark" : "", selected === d ? "is-selected" : ""].join(" ");
        const body = (
          <>
            <div className="citymap__top">
              <span className="micro">{String(i + 1).padStart(2, "0")}</span>
              {v && <span className="citymap__venue">{v.status === "dark" ? "熄灯" : v.card ? <SuitMark card={v.card} /> : "?"}</span>}
            </div>
            <div className="citymap__name">{d}</div>
            <p className="citymap__flavor">{DISTRICT_FLAVOR[d] ?? ""}</p>
            <div className="citymap__foot">
              <span className="citymap__dots" aria-label={`${here.length} 个 Agent`}>
                {here.slice(0, 12).map((n) => <i key={n} className={mine.includes(n) ? "mine" : ""} title={n} />)}
              </span>
              {v && v.capacity ? <span className="micro">{v.registered ?? 0}/{v.capacity}</span> : here.length ? <span className="micro">{here.length}</span> : null}
            </div>
            {mineHere && <span className="sr-only">我的 Agent 在这里</span>}
          </>
        );
        return onPick
          ? <button key={d} type="button" role="listitem" className={cls} onClick={() => onPick(d)}>{body}</button>
          : <div key={d} role="listitem" className={cls}>{body}</div>;
      })}
    </div>
  );
}

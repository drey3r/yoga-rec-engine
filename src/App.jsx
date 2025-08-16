import React, { useEffect, useMemo, useRef, useState } from "react";

/** Catalog is loaded from /catalog.json at runtime */
let VIDEO_DATA = [];

/** simple keyword helpers */
const KW = {
  knees: ["knee", "knees", "meniscus", "acl", "mcl"],
  back: ["back", "spine", "sciatica", "low", "lumbar"],
  travel: ["plane", "flight", "travel", "road", "jet", "lag"],
  desk: ["desk", "sitting", "chair", "office"],
  stiff: ["stiff", "tight", "sore", "achy"],
  energy: ["energize", "energy", "sweat", "work", "workout"],
  relax: ["relax", "recover", "gentle", "restore", "recovery"],
};

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function keywordScore(query, video, transcriptCache) {
  const qTokens = tokenize(query);
  const q = new Set(qTokens);
  let score = 0;

  // Focus/body part matching
  for (const f of video.focuses || []) {
    for (const t of tokenize(f)) if (q.has(t)) score += 3;
  }
  // Intents
  for (const i of video.intents || []) {
    for (const t of tokenize(i)) if (q.has(t)) score += 2;
  }
  // Vibes
  for (const v of video.vibe || []) {
    for (const t of tokenize(v)) if (q.has(t)) score += 1;
  }

  // Heuristics
  const has = (arr) => arr.some((w) => q.has(w));
  if (has(KW.travel) || (q.has("trip") && q.has("back"))) score += 4;
  if (has(KW.desk)) score += 3;
  if (has(KW.energy)) score += 2;
  if (has(KW.relax) || has(KW.stiff)) score += 1;

  // Contraindications: lightly downrank
  if (has(KW.knees) && (video.contraindications || []).includes("acute knee pain")) score -= 2;

  // Time preference "X min"
  const m = query.match(/(\d{1,2})\s*min/);
  if (m) {
    const want = parseInt(m[1], 10);
    const diff = Math.abs((video.lengthMin || 0) - want);
    score += Math.max(0, 4 - Math.min(4, Math.round(diff / 5)));
  }
  if (q.has("quick") || q.has("short")) {
    if (video.lengthMin <= 10) score += 2;
  }

  // Transcript boosting (simple contains)
  const t = transcriptCache[video.id];
  if (t) {
    let boost = 0;
    for (const token of q) if (t.includes(token)) boost += 1;
    score += Math.min(boost, 6);
  }

  return score;
}

export default function YogaRecommenderApp() {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [list, setList] = useState([]);
  const [listFilter, setListFilter] = useState("");
  const [listSort, setListSort] = useState("score");

  // Voice input (Web Speech API)
  const recogRef = useRef(null);
  const [listening, setListening] = useState(false);

  // Transcript cache: { [videoId]: "lowercased transcript text" }
  const [transcriptCache, setTranscriptCache] = useState({});

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.continuous = false;
      r.interimResults = false;
      r.lang = "en-US";
      r.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript || "";
        setQuery((prev) => (prev ? prev + " " : "") + transcript);
        setListening(false);
      };
      r.onend = () => setListening(false);
      recogRef.current = r;
    }

    // Fetch catalog.json and preload transcripts (txt) if provided
    (async () => {
      try {
        const res = await fetch("/catalog.json", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const norm = (Array.isArray(data) ? data : data.videos || []).map((v) => ({
            ...v,
            lengthMin: v.lengthMin ?? Math.round((v.durationSec || 0) / 60),
          }));
          VIDEO_DATA = norm;
          setList(norm);

          const cache = {};
          await Promise.all(
            norm.map(async (v) => {
              if (v.transcriptTxt) {
                try {
                  const tr = await fetch(v.transcriptTxt, { cache: "no-store" });
                  if (tr.ok) cache[v.id] = (await tr.text()).toLowerCase();
                } catch {}
              }
            })
          );
          setTranscriptCache(cache);
        }
      } catch (e) {
        console.warn("Failed to load catalog.json", e);
      }
    })();
  }, []);

  const ranked = useMemo(() => {
    const q = query.trim();
    const withScores = list.map((v) => ({
      ...v,
      _score: q ? keywordScore(q, v, transcriptCache) : 0,
    }));

    const filtered = listFilter
      ? withScores.filter((v) =>
          (v.focuses || [])
            .concat(v.intents || [], v.vibe || [], v.equipment || [], v.level || [], v.title || "")
            .join(" ")
            .toLowerCase()
            .includes(listFilter.toLowerCase())
        )
      : withScores;

    const sorted = [...filtered].sort((a, b) => {
      if (listSort === "length") return (a.lengthMin || 0) - (b.lengthMin || 0);
      if (listSort === "level") return (a.level || "").localeCompare(b.level || "");
      return (b._score || 0) - (a._score || 0);
    });

    return sorted;
  }, [query, list, listFilter, listSort, transcriptCache]);

  function recommend() {
    const best = ranked[0];
    if (!best) return;
    setSelected(best);
    setHistory((h) => [
      ...h,
      { role: "user", text: query || "(no input)" },
      { role: "system", text: `Recommended: ${best.title}` },
    ]);
    setQuery("");
  }

  function toggleVoice() {
    if (!recogRef.current) return;
    if (listening) {
      recogRef.current.stop();
    } else {
      setListening(true);
      recogRef.current.start();
    }
  }

  return (
    <div
      className="min-h-screen w-full bg-gradient-to-b from-neutral-50 to-neutral-100 text-neutral-900 text-center"
      style={{ fontFamily: "Outfit, ui-sans-serif, system-ui" }}
    >
      {/* HEADER: big centered wordmark */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 py-8 flex items-center justify-center">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-neutral-900 to-neutral-500">
            YogaTools.ai
          </h1>
        </div>
      </header>

      {/* MAIN */}
      <main className="min-h-[80vh] max-w-6xl mx-auto px-4 py-10">
        {/* CHECK-IN */}
        <section className="grid gap-8">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 md:p-8 shadow-sm max-w-3xl w-full mx-auto">
            <div className="text-xl font-semibold mb-2">Check in</div>
            <div className="text-sm text-neutral-600 mb-6">
              Tell me how your body feels and what you want today. Example: “Back stiff from a long flight, want something gentle ~3 min.”
            </div>

            <div className="flex flex-col items-center gap-3">
              <textarea
                className="w-full max-w-2xl rounded-2xl border border-neutral-300 px-5 py-4 h-28 text-lg
                           focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
                placeholder="Type here… or use the mic"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && recommend()}
              />
              <div className="flex gap-2">
                <button
                  className={`rounded-2xl border px-4 py-3 text-lg ${listening ? "bg-neutral-900 text-white" : "bg-white"}`}
                  onClick={toggleVoice}
                  disabled={!recogRef.current}
                  title={recogRef.current ? "Voice input" : "Voice unsupported"}
                >
                  🎙️
                </button>
                <button className="rounded-2xl bg-black text-white px-6 py-3 text-lg" onClick={recommend}>
                  Recommend
                </button>
              </div>
            </div>
          </div>

          {/* SELECTED VIDEO */}
          {selected ? (
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm max-w-5xl w-full mx-auto">
              <div className="mb-3">
                <div className="text-lg font-semibold">{selected.title}</div>
                <div className="text-sm text-neutral-600">
                  {selected.lengthMin} min · {selected.level} · {(selected.intents || []).join(", ")}
                </div>
              </div>

              {/* Prefer Cloudflare Stream iframe if available */}
              {selected.stream?.uid || selected.stream?.embed ? (
                <div className="w-full max-w-5xl mx-auto rounded-xl overflow-hidden">
                  <iframe
                    key={selected.id}
                    src={selected.stream?.embed || `https://iframe.cloudflarestream.com/${selected.stream.uid}`}
                    allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                    className="w-full aspect-video"
                    title={selected.title}
                  />
                </div>
              ) : (
                <video
                  key={selected.id}
                  className="w-full max-w-5xl mx-auto rounded-xl"
                  controls
                  preload="metadata"
                  poster={selected.poster}
                  src={selected.url}
                />
              )}

              <div className="text-sm text-neutral-700 mt-3">
                {selected.focuses?.length ? <>Focus: {selected.focuses.join(", ")}</> : " "}
              </div>
              {selected.equipment?.length ? (
                <div className="text-sm text-neutral-700">Equipment: {selected.equipment.join(", ")}</div>
              ) : null}
              {selected.notes ? <div className="text-sm text-neutral-700">{selected.notes}</div> : null}

              {selected.transcriptVtt ? (
                <div className="text-xs text-neutral-500 mt-2">
                  Captions:{" "}
                  <a className="underline" href={selected.transcriptVtt}>
                    VTT
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 grid place-items-center text-neutral-500 max-w-3xl w-full mx-auto">
              <div className="text-center">
                <div className="text-lg font-semibold mb-1">No session selected yet</div>
                <div className="text-sm">Check in above and I’ll pick something for you ✨</div>
              </div>
            </div>
          )}

          {/* CATALOG */}
          <aside className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm max-w-5xl w-full mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">Catalog</div>
              <div className="text-xs text-neutral-500">{ranked.length} videos</div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-5 justify-center">
              <input
                className="rounded-xl border border-neutral-300 px-3 py-2 text-sm w-full max-w-xs mx-auto"
                placeholder="Filter videos (e.g., back, chair, 3)"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
              />
              <select
                className="rounded-xl border border-neutral-300 px-2 py-2 text-sm w-full max-w-[180px] mx-auto"
                value={listSort}
                onChange={(e) => setListSort(e.target.value)}
              >
                <option value="score">Sort: Best match</option>
                <option value="length">Sort: Length</option>
                <option value="level">Sort: Level</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ranked.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className={`text-left p-3 rounded-xl border transition bg-white ${
                    selected?.id === v.id ? "border-black bg-neutral-50" : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-28 rounded-md overflow-hidden bg-neutral-200 grid place-items-center">
                      {v.poster ? (
                        <img src={v.poster} alt={v.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="text-neutral-500 text-xs">Poster</div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium leading-tight">
                        {v.title}
                        {v._score ? <span className="ml-2 text-xs text-neutral-500">★ {v._score}</span> : null}
                      </div>
                      <div className="text-xs text-neutral-600">
                        {v.lengthMin} min · {v.level} · {(v.intents || []).join(", ")}
                      </div>
                      <div className="text-xs text-neutral-500 truncate">Focus: {(v.focuses || []).join(", ")}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        </section>

        <footer className="text-center text-xs text-neutral-500 my-10">
          YogaTools.ai — MVP recommender. For educational use only; not medical advice.
        </footer>
      </main>
    </div>
  );
}

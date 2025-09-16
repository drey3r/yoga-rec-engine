import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Play, Clock, User } from 'lucide-react';

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

  // Fun random button colors
  const buttonColors = [
    '#3b82f6, #2563eb', // blue
    '#8b5cf6, #7c3aed', // purple  
    '#ef4444, #dc2626', // red
    '#10b981, #059669', // emerald
    '#f59e0b, #d97706', // amber
    '#ec4899, #db2777', // pink
    '#6366f1, #4f46e5', // indigo
    '#14b8a6, #0d9488'  // teal
  ];
  
  const [buttonColor] = useState(() => 
    buttonColors[Math.floor(Math.random() * buttonColors.length)]
  );

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

  // Get top 2 recommendations for "We'd recommend" / "Or maybe" display
  const topTwo = ranked.filter(v => v._score > 0).slice(0, 2);

  return (
    <div 
      className="min-h-screen"
      style={{
        background: 'linear-gradient(135deg, #fffbeb 0%, #fff7ed 50%, #fdf2f8 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      {/* Header */}
      <header className="pt-8 pb-4 px-6 w-full">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex items-center justify-center">
            <img 
              src="/yogatools_logo1.png" 
              alt="YogaTools.ai" 
              style={{ height: '64px', width: 'auto', objectFit: 'contain', maxWidth: '400px' }}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-6 pb-12 w-full flex-1">
        <div className="max-w-4xl mx-auto text-center" style={{paddingTop: '2rem'}}>
          
          {/* Hero Section */}
          <div className="text-center mb-12">
            <h2 style={{
              fontSize: 'clamp(2.5rem, 8vw, 4rem)',
              fontWeight: '300',
              marginBottom: '1.5rem',
              lineHeight: '1.1',
              color: '#374151'
            }}>
              How are you feeling?
            </h2>
            <p style={{
              fontSize: '1.25rem',
              fontWeight: '300',
              maxWidth: '32rem',
              margin: '0 auto',
              color: '#6b7280'
            }}>
              Check in with yourself. Share whatever comes to mind to start your practice.
            </p>
          </div>

          {/* Input Section */}
          <div className="max-w-3xl mx-auto mb-16">
            <div style={{position: 'relative'}}>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="I'm feeling..."
                style={{ 
                  width: '100%',
                  minHeight: '120px',
                  padding: '1.5rem',
                  fontSize: '1.125rem',
                  border: 'none',
                  borderRadius: '24px',
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  backdropFilter: 'blur(10px)',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  color: '#374151',
                  resize: 'none',
                  outline: 'none',
                  transition: 'all 0.3s ease'
                }}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && recommend()}
              />
              
              {/* Voice Button */}
              <button
                onClick={toggleVoice}
                disabled={!recogRef.current}
                style={{ 
                  position: 'absolute',
                  bottom: '16px',
                  right: '16px',
                  width: '68px',
                  height: '68px',
                  backgroundColor: listening ? '#ef4444' : '#f3f4f6',
                  color: listening ? 'white' : '#6b7280',
                  border: 'none',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 8px 12px -2px rgba(0, 0, 0, 0.15)',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                title={listening ? 'Stop listening' : 'Speak your feelings'}
              >
                {listening ? <MicOff size={30} /> : <Mic size={30} />}
              </button>
            </div>

            {/* Recommend Button */}
            <div className="text-center mt-8">
              <button
                onClick={recommend}
                disabled={!query.trim()}
                style={{
                  padding: '16px 48px',
                  background: `linear-gradient(135deg, ${buttonColor})`,
                  color: 'white',
                  fontSize: '18px',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '50px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                  cursor: query.trim() ? 'pointer' : 'not-allowed',
                  opacity: query.trim() ? 1 : 0.5,
                  transition: 'all 0.3s ease'
                }}
              >
                Find my yoga
              </button>
            </div>
          </div>

          {/* Recommendations - New Beautiful Display */}
          {query.trim() && topTwo.length > 0 && (
            <div className="max-w-5xl mx-auto mb-16">
              <div style={{display: 'grid', gridTemplateColumns: topTwo.length > 1 ? 'repeat(2, 1fr)' : '1fr', gap: '2rem'}}>
                {/* Primary Recommendation */}
                <div>
                  <h3 style={{fontSize: '1.5rem', fontWeight: '300', color: '#374151', marginBottom: '1.5rem', textAlign: 'center'}}>
                    We'd recommend
                  </h3>
                  <RecommendationCard 
                    video={topTwo[0]} 
                    isPrimary={true}
                    onSelect={() => setSelected(topTwo[0])}
                  />
                </div>

                {/* Alternative Recommendation */}
                {topTwo[1] && (
                  <div>
                    <h3 style={{fontSize: '1.5rem', fontWeight: '300', color: '#374151', marginBottom: '1.5rem', textAlign: 'center'}}>
                      Or maybe
                    </h3>
                    <RecommendationCard 
                      video={topTwo[1]} 
                      isPrimary={false}
                      onSelect={() => setSelected(topTwo[1])}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected Video Player */}
          {selected && (
            <div className="max-w-5xl mx-auto mb-16">
              <div style={{backgroundColor: 'white', borderRadius: '24px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', overflow: 'hidden'}}>
                <div style={{padding: '1.5rem', borderBottom: '1px solid #f3f4f6'}}>
                  <h3 style={{fontSize: '1.5rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem'}}>{selected.title}</h3>
                  <div style={{display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', color: '#6b7280'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
                      <Clock size={16} />
                      <span>{selected.lengthMin} min</span>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
                      <User size={16} />
                      <span>{selected.level}</span>
                    </div>
                    {selected.intents?.length > 0 && (
                      <span>{selected.intents.join(", ")}</span>
                    )}
                  </div>
                </div>

                <div style={{aspectRatio: '16/9'}}>
                  {selected.stream?.uid || selected.stream?.embed ? (
                    <iframe
                      key={selected.id}
                      src={selected.stream?.embed || `https://iframe.cloudflarestream.com/${selected.stream.uid}`}
                      allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      style={{width: '100%', height: '100%'}}
                      title={selected.title}
                    />
                  ) : (
                    <video
                      key={selected.id}
                      style={{width: '100%', height: '100%'}}
                      controls
                      preload="metadata"
                      poster={selected.poster}
                      src={selected.url}
                    />
                  )}
                </div>

                {(selected.focuses?.length || selected.equipment?.length || selected.notes) && (
                  <div style={{padding: '1.5rem', backgroundColor: '#f9fafb'}}>
                    {selected.focuses?.length > 0 && (
                      <div style={{fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem'}}>
                        <span style={{fontWeight: '500'}}>Focus:</span> {selected.focuses.join(", ")}
                      </div>
                    )}
                    {selected.equipment?.length > 0 && (
                      <div style={{fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem'}}>
                        <span style={{fontWeight: '500'}}>Equipment:</span> {selected.equipment.join(", ")}
                      </div>
                    )}
                    {selected.notes && (
                      <div style={{fontSize: '0.875rem', color: '#374151'}}>{selected.notes}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Catalog - Keep your existing catalog but hide it initially */}
          {(selected || query.trim()) && (
            <details className="max-w-5xl mx-auto">
              <summary style={{cursor: 'pointer', textAlign: 'center', color: '#6b7280', marginBottom: '2rem'}}>
                Browse all {ranked.length} classes
              </summary>
              
              <div style={{backgroundColor: 'white', borderRadius: '24px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '2rem'}}>
                <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem'}}>
                  <input
                    style={{
                      flex: 1,
                      borderRadius: '16px',
                      border: '1px solid #d1d5db',
                      padding: '0.75rem 1rem',
                      fontSize: '0.875rem',
                      outline: 'none'
                    }}
                    placeholder="Filter classes..."
                    value={listFilter}
                    onChange={(e) => setListFilter(e.target.value)}
                  />
                  <select
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #d1d5db',
                      padding: '0.75rem 1rem',
                      fontSize: '0.875rem',
                      outline: 'none'
                    }}
                    value={listSort}
                    onChange={(e) => setListSort(e.target.value)}
                  >
                    <option value="score">Best match</option>
                    <option value="length">Length</option>
                    <option value="level">Level</option>
                  </select>
                </div>

                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem'}}>
                  {ranked.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setSelected(v)}
                      style={{
                        textAlign: 'left',
                        padding: '1rem',
                        borderRadius: '16px',
                        border: selected?.id === v.id ? '2px solid #fb923c' : '1px solid #e5e7eb',
                        backgroundColor: selected?.id === v.id ? '#fff7ed' : 'white',
                        boxShadow: selected?.id === v.id ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{display: 'flex', alignItems: 'flex-start', gap: '0.75rem'}}>
                        <div style={{
                          height: '64px',
                          width: '112px',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          backgroundColor: '#f3f4f6',
                          flexShrink: 0
                        }}>
                          {v.poster ? (
                            <img src={v.poster} alt={v.title} style={{height: '100%', width: '100%', objectFit: 'cover'}} />
                          ) : (
                            <div style={{height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                              <Play size={20} style={{color: '#9ca3af'}} />
                            </div>
                          )}
                        </div>
                        <div style={{flex: 1, minWidth: 0}}>
                          <div style={{fontWeight: '500', lineHeight: '1.25', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {v.title}
                            {v._score > 0 && <span style={{marginLeft: '0.5rem', fontSize: '0.75rem', color: '#fb923c'}}>★ {v._score}</span>}
                          </div>
                          <div style={{fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem'}}>
                            {v.lengthMin} min · {v.level}
                          </div>
                          {v.intents?.length > 0 && (
                            <div style={{fontSize: '0.75rem', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.25rem'}}>
                              {v.intents.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </details>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="pb-8 px-6 w-full">
        <div className="max-w-4xl mx-auto text-center">
          <p style={{color: '#9ca3af', fontSize: '14px', marginBottom: '8px'}}>
            Classes courtesy of Kanda Yoga School
          </p>
          <p style={{color: '#d1d5db', fontSize: '12px'}}>
            For educational use only; not medical advice.
          </p>
        </div>
      </footer>
    </div>
  );
}

const RecommendationCard = ({ video, isPrimary, onSelect }) => {
  return (
    <div 
      onClick={onSelect}
      style={{
        backgroundColor: 'white',
        borderRadius: '24px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        border: isPrimary ? '2px solid #fed7aa' : 'none'
      }}
    >
      {/* Video Thumbnail */}
      <div style={{
        aspectRatio: '16/9',
        background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {video.poster ? (
          <img 
            src={video.poster} 
            alt={video.title} 
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        ) : (
          <Play size={48} style={{color: '#9ca3af'}} />
        )}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Play size={48} style={{color: 'white', opacity: 0}} />
        </div>
      </div>
      
      {/* Card Content */}
      <div style={{padding: '1.5rem'}}>
        <h4 style={{fontSize: '1.25rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem'}}>
          {video.title}
        </h4>
        
        <p style={{color: '#6b7280', marginBottom: '1rem', lineHeight: '1.5'}}>
          {video.notes || `${video.intents?.join(", ") || "Practice"} focusing on ${video.focuses?.join(", ") || "movement"}`}
        </p>
        
        {/* Meta Information */}
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.875rem', color: '#9ca3af'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
              <Clock size={16} />
              <span>{video.lengthMin} min</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
              <User size={16} />
              <span>{video.level}</span>
            </div>
          </div>
          {video.vibe?.length > 0 && (
            <div style={{color: '#fb923c', fontWeight: '500', textTransform: 'capitalize'}}>
              {video.vibe[0]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
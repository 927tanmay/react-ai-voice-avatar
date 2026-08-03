/**
 * React Indic Avatar — Local Kiosk Example
 *
 * Demonstrates running an interactive kiosk assistant entirely offline on a local device
 * while configuring the LLM engine via the `llmModel` prop for rapid boot times.
 *
 * Key Features Illustrated:
 *   • Explicit LLM selection via `llmModel` prop (optimizing for lightweight fast-loading weights)
 *   • Live download progress tracking during initial model initialization
 *   • Built-in captions synchronization via `showCaptions`
 *   • High-end studio lighting & glassmorphism menu UI for real-world deployment
 *   • Kokoro TTS engine for ultra-realistic conversational dialogue
 *
 * Run locally: npm install && npm run dev
 */
import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IndicAvatar } from 'react-indic-avatar';

export default function App() {
  const [status, setStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const [loadingPct, setLoadingPct] = useState<number>(0);
  const [currentModelLoading, setCurrentModelLoading] = useState<string>('Initializing AI workers...');

  // Sample restaurant menu items for the interactive display
  const menuItems = [
    { id: '1', name: 'Paneer Tikka Roll', price: '₹180', desc: 'Spiced cottage cheese wrapped in roomali roti with mint chutney.' },
    { id: '2', name: 'Steamed Corn & Cheese Momos', price: '₹150', desc: 'Delicate dumplings served with Fiery Tibetan garlic sauce.' },
    { id: '3', name: 'Masala Chai & Bun Maska', price: '₹90', desc: 'Cardamom infused Indian tea paired with warm buttered Brioche bun.' },
    { id: '4', name: 'Saffron Pista Kulfi', price: '₹120', desc: 'Traditional artisan frozen dessert made with whole reduced milk and pistachio.' },
  ];

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100vw', backgroundColor: '#0B0E14', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif", color: '#E2E8F0' }}>
      
      {/* Top Header Branding & Status Information */}
      <div style={{ position: 'absolute', zIndex: 20, top: '24px', left: '32px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 8px 24px rgba(245, 158, 11, 0.35)' }}>
          🍲
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: '#FFF' }}>Roll Farm Kiosk</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', fontWeight: 500 }}>AI Voice Concierge • 100% On-Device WebGPU Processing</p>
        </div>
      </div>

      {/* Model Download Progress Toast (Only displayed while weights are caching in background) */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute', top: '90px', left: '32px', zIndex: 25,
          background: 'rgba(30, 41, 59, 0.85)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: '14px',
          padding: '14px 20px', width: '340px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#F59E0B' }}>
            <span>⏳ {currentModelLoading}</span>
            <span>{Math.round(loadingPct * 100)}%</span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(loadingPct * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #F59E0B, #10B981)', transition: 'width 0.2s ease' }} />
          </div>
          <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: 1.4 }}>
            Tip: We selected a lightweight 0.5B parameter instruction model for lightning-fast boot times on typical kiosk hardware!
          </p>
        </div>
      )}

      {/* Interactive Restaurant Menu Panel on the Right */}
      <div style={{
        position: 'absolute', right: '32px', top: '32px', zIndex: 15, width: '380px',
        maxHeight: 'calc(100vh - 64px)', overflowY: 'auto',
        background: 'rgba(18, 24, 38, 0.75)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '24px', padding: '24px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)'
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#F59E0B', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📖</span> Today's Special Specials
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {menuItems.map((item) => (
            <div key={item.id} style={{
              padding: '16px', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)', transition: 'transform 0.2s ease, borderColor 0.2s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#FFF' }}>{item.name}</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#10B981' }}>{item.price}</span>
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: 1.4 }}>{item.desc}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', color: '#64748B', textAlign: 'center' }}>
          💬 Ask our avatar anything about ingredients, vegan options, or recommendations!
        </div>
      </div>

      {/* 3D Studio Canvas Viewport */}
      {/* 3D Studio Canvas Viewport */}
      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
        <color attach="background" args={['#0B0E14']} />
        
        {/* Warm saffron & cool ambient studio lighting */}
        <pointLight position={[-3, 2, -2]} intensity={25} color="#F59E0B" distance={6} />
        <pointLight position={[3, 1, -2]} intensity={18} color="#3B82F6" distance={6} />
        
        <OrbitControls target={[0, 0.05, 0]} minDistance={0.8} maxDistance={4} />

        <IndicAvatar
          avatarPreset="kiosk"
          
          // EXPLICIT LLM OVERRIDE SELECTION:
          // For rapid startup times on kiosk hardware, we explicitly configure a lightweight 0.5B instruction
          // model. You can also substitute heavier models like 'onnx-community/Llama-3.2-1B-Instruct' if VRAM permits!
          llmModel="onnx-community/Qwen2.5-0.5B-Instruct"

          // Configure ultra-natural Kokoro voice engine with studio presets
          ttsEngine="kokoro"
          ttsVoice="af_heart"
          environmentPreset="studio"
          
          // Enable real-time captions overlay for accessible noise-heavy environments
          showCaptions={true}
          
          systemPrompt="You are Tara, an enthusiastic, highly knowledgeable voice concierge for Roll Farm restaurant. You have complete mastery of our live menu database: 1) Paneer Tikka Roll (₹180): spiced marinated cottage cheese wrapped in a thin roomali roti with fresh mint-coriander chutney and pickled shallots (Vegetarian, mild spice). 2) Steamed Corn & Cheese Momos (₹150): 6 delicate handmade dumplings served with our signature Fiery Tibetan red pepper garlic sauce and clear broth (Vegetarian, high spice sauce). 3) Masala Chai & Bun Maska (₹90): classic cardamom and fresh ginger Indian boiled tea paired with a warm toasted Brioche bun lathered in sweetened heritage butter. 4) Saffron Pista Kulfi (₹120): artisan traditional frozen dessert slow-churned from whole reduced milk, green cardamom, roasted pistachios, and pure saffron strands (Gluten-free, chilled sweet). Special Combo offer: Any Roll + Masala Chai for just ₹250 (saving ₹20!). Our kitchen is open 11 AM to 11 PM daily. When interacting with customers, always sound natural, friendly, and helpful like a real human waiter conversing out loud. Quote exact menu prices in Rupees whenever relevant. Keep your verbal replies brief (1 to 2 spoken sentences) and never use lists, markdown formatting, or bullet points."

          scale={0.48}
          position={[-0.28, -0.42, 0]} // Compact avatar scale positioned cleanly to stay clear of overlays
          
          onStatusChange={(newStatus) => setStatus(newStatus)}
          loadingProgress={(pct, label) => {
            setLoadingPct(pct);
            setCurrentModelLoading(`Downloading ${label.toUpperCase()} model...`);
          }}
          accentColor="#F59E0B"
        />
      </Canvas>
    </div>
  );
}

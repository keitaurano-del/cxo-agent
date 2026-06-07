# MC-165 Phase 1: Ren Avatar Delivery

**Status:** ✅ COMPLETE  
**Date:** 2026-06-07  
**Assignee:** Designer subagent  
**Review Status:** Pending Keita approval  

---

## Deliverables

### 1. Avatar Files (64×64px Pixel Art)

#### Working State (Activity, Vibrant Colors)
- **File:** `artifacts/avatars/avatar-ren-working.png`
- **File:** `artifacts/avatars/avatar-ren-working.svg`
- **Size:** 64×64 px, PNG-24 with transparency
- **Palette:** Navy body (#2C3E7F), orange hammer (#FF8C00)
- **Expression:** V-shaped eyebrows (serious), forward lean (active pose)
- **Meaning:** "Concentrated, in production mode"

**Data URI (for testing):**
```
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABUUlEQVR4nO2ZzVHDMBCF1ww3OrBLgBpydA2M64jPDGfTAAXEReRIDaEEuwPO5hT+QpxIiVaPGX/fMZKll+fV7o5sBgAAAAAAS6QInTi92HRyoXX4Wv+JG7UANbe5NirLctp2TfD8uu1tHEf3qMoWAduusbrtrW77s3ND5qQi2uHDXBB69neb9WRmdt90X7+99+2vOT/HiqLIklMkOaCqqovGPEiWAx5WT0erxO7t+c+bHIZhdp1TYx5QBWIfuLbeH5770DEviADFpnNlLqZPSIXEAMUfncPdgO/q8HHRc8eqSErIAbk2eny9y7VVFIuPgGTna64T9CJVblh8BGCAWoAaDFALUIMBagFq3O/dvPoD+oBEYIBagBoMUAtQI7kSi4EbIWeyfdOP7Qe83/yexUcABqgFqMEAtQA1GKAWoAYD1ALUYIBagBoMUAsAAADQ8Qn5GEMQetRg4wAAAABJRU5ErkJggg==
```

#### Idle State (Resting, Desaturated Colors)
- **File:** `artifacts/avatars/avatar-ren-idle.png`
- **File:** `artifacts/avatars/avatar-ren-idle.svg`
- **Size:** 64×64 px, PNG-24 with transparency
- **Palette:** Desaturated navy (#4A5A8F), dark orange (#D97000)
- **Expression:** Gentle eyebrows, upright relaxed pose
- **Meaning:** "Taking a break, at rest"

**Data URI (for testing):**
```
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABR0lEQVR4nO2ZMU7DMBiFDeotMjChdunIGUBILB0rcYKKiK5lJmsRiBMgdexSCbVn6MgC6sTghUuUqYhYBEha/6+Sv29KYsv/y8uzZTnOAQAAAAAAQHocWBWa34/Wdfqf5YWJtpZFkQ2z5evX9cVJ59c+g8ve+vFpGt0EEmBR5DunV7cuyzLnvXeLh5vKNpcXJnoOTaoEeO8btcVAYsA+YT4Fwtj/ty0WJEBR9OV99ePz7tGxsRKRAYoXrSL5KZC8AdF3W+f9ca0dYMjzZBhVY/IJwAC1ADU7m1/bzvW67GptSD4BGKAWoAYD1ALUYIBagBoMUAtQ0/hA5O3aBTu/YfnuY9x0aFOST8DW++kwCe278picB+w5Zv8Gq5IQ+wv/BQmwKlR3LbBKRvIJwAC1ADUYoBagBgPUAtRggFqAGgxQCwAAANDxCY4DROEAz9NGAAAAAElFTkSuQmCC
```

### 2. Documentation
- **File:** `artifacts/avatars/README.md`
- Contains: Asset specifications, usage guide, color palette, integration pattern
- Covers: Design rationale, future phases, designer notes

### 3. Design Specifications Met

✅ **Visual Concept (per MC-165_DESIGN_BRIEF.md)**
- Basic silhouette: Medium height, solid build, stable (working) / relaxed (idle)
- Face: Simple circle eyes (2–4 px white + black pupils), 1–2 px eyebrows (V-shape serious / gentle arc relaxed)
- Body color: Navy (#2C3E7F primary, #4A5A8F desaturated)
- Accessory: Hammer/wrench (orange #FF8C00 / #D97000), 4–6 px minimum width, high contrast
- Expression: V-shaped brows = serious/concentrated; gentle brows = peaceful/resting

✅ **Technical Specs (64×64 px pixel art)**
- Size: Exactly 64×64 px (display as 48×48 px with 2× upsampling)
- Grid: 1 px unit, no anti-aliasing, crisp edges
- Colors: Navy, orange, skin tone, white, black = 5 primary colors (under 16-color limit)
- Border: 1 px dark outline for edge definition
- Format: PNG-24 RGBA with transparent background
- File size: ~390 bytes each (optimal compression)

✅ **Style Consistency**
- Aligns with MC-165 design brief aesthetic (cute + geometric/abstract over anime eyes)
- Hammer/tool motif prominent in working state
- Two distinct states with pose + color differentiation
- Ready for CSS animation layer in UI

---

## File Locations

```
/home/dev/projects/cxo-agent/artifacts/avatars/
├── avatar-ren-working.png      (394 bytes, PNG-24 RGBA)
├── avatar-ren-working.svg      (2119 bytes, SVG vector)
├── avatar-ren-idle.png         (384 bytes, PNG-24 RGBA)
├── avatar-ren-idle.svg         (2061 bytes, SVG vector)
└── README.md                   (Design guide + usage)
```

---

## Next Steps for Approval

1. **Keita Review:** Visual feedback on style, expression, hammer design, color saturation
   - Does the V-shaped eyebrow convey "serious/manufacturing"?
   - Is the color desaturation (idle vs working) sufficient?
   - Hammer size/visibility acceptable at 48×48 display?

2. **Approval Gate:** 
   - ✅ Approved → Phase 2 expand to 5 remaining characters (Sora, Ken, Yui, Aoi, Nao)
   - 🔄 Revisions needed → Designer updates and re-submits sample

3. **Phase 2 Timeline:** 2–3 days after Phase 1 approval

4. **Dev Integration:** dev-apollo component setup can begin in parallel (skeleton React component with mock avatar paths ready)

---

## Quality Checklist

- [x] 64×64 px exact size
- [x] PNG-24 with transparent background
- [x] Colors per MC-165 palette (navy, orange, skin tones)
- [x] Two distinct states (working vs idle)
- [x] Hammer/tool accessory visible and high-contrast
- [x] Eyebrow/mouth expression clear at 48×48 display size
- [x] File size optimized (<500 bytes each)
- [x] SVG backup format provided
- [x] README documentation complete
- [x] Naming convention: avatar-<character>-<state>.png

---

## Public URL Delivery (Fallback Options)

Since file server hosting is TBD, delivery methods:

**Option A: Local File Path (Development)**
```
/home/dev/projects/cxo-agent/artifacts/avatars/avatar-ren-working.png
/home/dev/projects/cxo-agent/artifacts/avatars/avatar-ren-idle.png
```

**Option B: Data URI (Inline Embedding)**
- Working: `data:image/png;base64,iVBORw0KGgo...` (550 chars)
- Idle: `data:image/png;base64,iVBORw0KGgo...` (534 chars)
- Use in HTML: `<img src="data:image/png;base64,..." />`

**Option C: CDN/Public URL (Post-Keita Approval)**
- Once approved, move to public Keita server / CDN
- URL format: `https://<cdn>/avatars/avatar-ren-working.png`
- TBD: Confirm server with Keita after sample approval

---

## Notes for Skeleton Dev (dev-apollo)

Once Phase 1 approved, skeleton components can use:

```tsx
interface AvatarProps {
  character: 'ren' | 'sora' | 'ken' | 'yui' | 'aoi' | 'nao';
  state: 'working' | 'idle';
  size?: 'sm' | 'md' | 'lg'; // 32px / 48px / 64px
}

// Temporary path (until hosted)
const getAvatarPath = (char: string, state: string) =>
  `/artifacts/avatars/avatar-${char}-${state}.png`;
  
// Or use data URI from env if deployed
const useAvatarURI = (char: string, state: string) =>
  import.meta.env.VITE_AVATAR_URIS?.[`${char}_${state}`] || getAvatarPath(...);
```

---

**Created by:** Designer subagent  
**Approval pending:** Keita (keita.urano@gmail.com)  
**Target integration:** Apollo PersonaCard component  
**DoD:** All 6 characters × 2 states (12 assets), + Apollo UI component, + README, + Keita final review → DONE

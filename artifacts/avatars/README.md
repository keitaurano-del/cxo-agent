# Apollo Agent Avatars

## Overview

This directory contains pixel art avatars for the Apollo dashboard agent personas. Each character has two states: `working` (active, vibrant) and `idle` (resting, desaturated).

## Current Assets (Phase 1 - Sample: Ren)

### Ren（蓮）- Implementation & Tools
**Role:** dev-logic（Development, implementation, debugging）  
**Motif:** Hammer, screwdriver, wrench  
**Personality:** Serious, craftsman-like, detail-oriented  

#### File Format
- **PNG:** `avatar-ren-working.png` / `avatar-ren-idle.png`（64×64 px, transparent background）
- **SVG:** `avatar-ren-working.svg` / `avatar-ren-idle.svg`（vector format）

#### Visual Design

**Working State** (`avatar-ren-working.png`)
- **Pose:** Body leaning forward, left arm raised holding hammer
- **Expression:** V-shaped eyebrows (serious/focused), determined mouth
- **Colors:** Navy blue body (#2C3E7F), orange hammer (#FF8C00), skin tone (#D4A574)
- **Meaning:** "Concentrated, in production mode"

**Idle State** (`avatar-ren-idle.png`)
- **Pose:** Upright stance, hammer resting on ground, weight on one leg
- **Expression:** Gentle/relaxed eyebrows, peaceful mouth
- **Colors:** Desaturated navy (#4A5A8F), darker orange (#D97000), warm skin tone (#B8927A)
- **Meaning:** "Taking a break, at rest"

## Specification

### Technical Specs
- **Size:** 64×64 pixels (display size: 48×48 px with 2× upsampling)
- **Grid:** 1 px unit, integer-aligned grid snapping (no anti-aliasing)
- **Color Palette:** Maximum 16 colors per character
- **Border:** 1–2 px dark outline (black or dark purple)
- **Format:** PNG-24 with alpha channel (transparent background)
- **Compression:** PNG level 9

### Style Guide (Per MC-165_DESIGN_BRIEF.md)

#### Face Elements
- **Eyes:** 2–4 px white dots + black pupils (expressiveness primary)
- **Eyebrows:** 1–2 px thickness, emotion expression via angle
  - Upward = positive
  - V-shape = serious/concentrated
  - Gentle arc = relaxed
- **Mouth:** Minimal (optional: 1–2 px line or small curve)

#### Accessories
- **Size:** Minimum 4–6 px width for visibility
- **Color:** Contrasting color to body (e.g., orange hammer on navy body)
- **Design:** Single-layer silhouette, simple geometry

#### Animation
- No animation in static file (2 states only)
- CSS animation (pulse, sway) can be added in UI layer

## Color Palette (Ren)

| Element | Working | Idle | Hex |
|---------|---------|------|-----|
| Body | Navy | Desaturated Navy | #2C3E7F / #4A5A8F |
| Hammer | Orange | Dark Orange | #FF8C00 / #D97000 |
| Skin | Peachy | Warm Tan | #D4A574 / #B8927A |
| Eyes | White | White | #FFFFFF |
| Pupils/Outline | Black | Black | #1A1A1A |

## Usage in Apollo Dashboard

### Import Pattern (React)

```tsx
// avatars/index.ts
import avatarRenWorking from './avatar-ren-working.png';
import avatarRenIdle from './avatar-ren-idle.png';

export const avatarRen = {
  working: avatarRenWorking,
  idle: avatarRenIdle,
};

// In component
<img 
  src={state === 'working' ? avatarRen.working : avatarRen.idle}
  alt="Ren avatar"
  className="avatar-48"
/>
```

### CSS
```css
.avatar-48 {
  width: 48px;
  height: 48px;
  image-rendering: pixelated; /* Preserve pixel-perfect edge */
}

/* Optional: Add subtle animation */
.avatar-48[data-state="working"] {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}
```

## File Organization

```
avatars/
├── avatar-ren-working.png
├── avatar-ren-working.svg
├── avatar-ren-idle.png
├── avatar-ren-idle.svg
└── README.md （this file）
```

## Future Phases

**Phase 2:** Expand to remaining 5 characters
- Sora（衛星）— UI/Dashboard
- Ken（検証）— Testing/QA
- Yui（台帳）— Task Management
- Aoi（デザイン）— Design
- Nao（執筆）— Content Creation

## Notes for Designers

1. **Pixel-perfect grid:** Always work at 64×64 with 1 px snapping. Use Figma's grid (1 px) to align elements.
2. **Color consistency:** Adhere to the palette in MC-165_DESIGN_BRIEF.md for visual harmony across all 6 agents.
3. **Accessibility:** Ensure 2–3 px minimum contrast gaps between adjacent colors for readability at 48×48 display size.
4. **Simplicity:** Less is more. Avoid over-detailed features; focus on silhouette recognition.

## License

These assets are part of the Apollo dashboard design system and are for internal Apollo project use.

---

**Phase 1 Created:** 2026-06-07  
**Creator:** Designer subagent  
**Status:** Sample approval pending (Keita)  
**Next Step:** Integrate into Apollo dashboard PersonaCard after approval

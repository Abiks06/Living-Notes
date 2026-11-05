export const particleVertexShader = /* glsl */ `
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform int uTextureSize;
uniform float uPointSize;
uniform float uPointScale;
uniform float uAlphaScale;
uniform float uExposure;
uniform float uIntensity;
uniform float uGate;
uniform float uCentroid;
uniform float uSparkleSeed;
uniform float uFocalDistance;
uniform float uAperture;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uBass;
uniform float uTreble;
uniform float uHat;
uniform float uInhale;
uniform float uVocal;
uniform float uSpecies;
uniform float uPresence;
uniform float uBeat;
uniform float uSnap;
uniform float uFlat;
uniform float uHit;
uniform float uNotePlace;
uniform float uNoteGlow;
uniform float uTension;
uniform float uWorld;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uColorD;

varying vec3 vColor;
varying float vAlpha;
varying vec2 vDirection;
varying float vStretch;
varying float vCoc;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  // No vertex attributes: the vertex index *is* the particle's texel address.
  ivec2 texel = ivec2(gl_VertexID % uTextureSize, gl_VertexID / uTextureSize);
  vec4 data = texelFetch(uPositions, texel, 0);
  vec4 velData = texelFetch(uVelocities, texel, 0);
  float seed = data.w;

  // Physics takes a fifth of a second to answer a hit, which is too soft for an attack. So hits
  // also land here, where they move on the very frame the sound arrives and cost no lag.
  float snap = uSnap * (0.6 + 0.8 * seed);
  vec3 placed = mix(
    data.xyz * (1.0 + snap),
    data.xyz + vec3(0.0, snap * 3.2 * (1.0 - smoothstep(1.0, 6.0, length(data.xz))), 0.0),
    uFlat
  );

  vec4 mvPosition = modelViewMatrix * vec4(placed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Highs sparkle: a random ~4% of particles flash, re-rolled on each hi-hat. A hat flashes
  // by itself, as hats tucked under a mix are audible but never lift the treble band.
  float flicker = step(0.96, hash(seed * 97.13 + uSparkleSeed));
  float sparkle = flicker * max(smoothstep(0.2, 0.85, uTreble), uHat);

  // Heat = the scene's glow (velocity.w) plus motion, lifted by a bright sound.
  float speed = clamp(length(velData.xyz) * 0.25, 0.0, 1.0);
  float heat = clamp(velData.w * 0.85 + speed * 0.45 + (uCentroid - 0.45) * 0.5, 0.0, 1.0);
  // Each note lights the band of particles at its own pitch, so a riff runs up and down the form.
  float fromNote = (mix(placed.y, length(placed.xz), uFlat) - uNotePlace) / 0.38;
  float noteBand = exp(-fromNote * fromNote) * uNoteGlow;
  heat = clamp(heat + noteBand * 0.9, 0.0, 1.0);

  // Depth of field: particles away from the focal plane spread into dim bokeh discs.
  float depth = -mvPosition.z;
  float coc = clamp(abs(depth - uFocalDistance) / (uFocalDistance * 0.45) * uAperture, 0.0, 1.0);
  float spread = 1.0 + coc * 1.7;

  // Heavy core orbs and fine stardust, unless a voice has borrowed the core for its ribbons.
  float core = (1.0 - smoothstep(0.16, 0.2, seed)) * (1.0 - uVocal);
  float dust = smoothstep(0.83, 0.87, seed);
  float species = mix(1.0, mix(1.0, 1.45, core) * mix(1.0, 0.55, dust), uSpecies);
  float size = uPointSize * uPointScale * (0.6 + seed * 0.8) * (1.0 + uBass * 0.25 + sparkle * 0.9 + uHit * 0.5 + uWorld * 0.12) * species;
  float pixels = size * uPixelRatio / depth * spread;

  // Motion streaks: stretch the sprite along where it's heading on screen.
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(placed + velData.xyz * 0.035, 1.0);
  vec2 travel = (ahead.xy / ahead.w - gl_Position.xy / gl_Position.w) * 0.5 * uResolution;
  float distancePx = length(travel);
  // Melodies draw longer strokes.
  float longest = mix(4.0, 5.5, uVocal);
  vStretch = mix(clamp(1.0 + distancePx / max(pixels, 1.0), 1.0, longest), 1.0, coc);
  vDirection = distancePx > 0.01 ? travel / distancePx : vec2(1.0, 0.0);
  vCoc = coc;

  // Cap on-screen size: zooming into 262k additive points must not explode fill rate.
  gl_PointSize = min(pixels * vStretch, 22.0 * uPixelRatio);

  vec3 color = mix(uColorA, uColorB, smoothstep(0.0, 0.55, heat + seed * 0.15));
  color = mix(color, uColorC, smoothstep(0.55, 1.0, heat));
  // A drop's section burns hotter, reaching for the brightest colour the palette has.
  color = mix(color, uColorD, uWorld * 0.32 * smoothstep(0.35, 1.0, heat));
  vColor = mix(color, uColorD, sparkle);

  // Spreading the same light over a bigger area dims it, as a real lens does.
  float light = (0.3 + 0.45 * heat + 0.5 * sparkle + 0.12 * uBeat + 0.9 * noteBand) * uAlphaScale * uExposure;
  float section = mix(0.55, 0.8 + 0.3 * uIntensity, uGate) * (1.0 - 0.3 * uInhale) * mix(0.5, 1.0, uPresence);
  section *= (1.0 - 0.5 * uTension) * (1.0 + 0.22 * uWorld + 1.4 * uHit * uHit);
  vAlpha = light * section / (spread * spread * vStretch);
}
`;

export const particleFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying vec2 vDirection;
varying float vStretch;
varying float vCoc;

void main() {
  vec2 c = (gl_PointCoord - 0.5) * 2.0;
  c.y = -c.y;
  float along = dot(c, vDirection);
  float across = dot(c, vec2(-vDirection.y, vDirection.x)) * vStretch;
  float d = along * along + across * across;
  if (d > 1.0) discard;

  // In focus: a tight bright core. Out of focus: a soft flat disc with a faint rim.
  float core = pow(1.0 - d, 2.6);
  float disc = 0.3 * (smoothstep(1.0, 0.8, d) + 0.5 * smoothstep(0.55, 0.9, d));
  float shape = mix(core, disc, vCoc);

  gl_FragColor = vec4(vColor, shape * vAlpha);
  #include <colorspace_fragment>
}
`;

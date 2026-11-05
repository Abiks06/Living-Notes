# Media

Put `demo.gif` (or a screenshot) here for the README. Record it with the app's own **Record 10s** button, then convert, e.g.:

```bash
ffmpeg -i resonance-clip.mp4 -vf "fps=20,scale=960:-1:flags=lanczos" -loop 0 docs/demo.gif
```

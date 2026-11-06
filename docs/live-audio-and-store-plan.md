# Plan: closing the live audio gap, and the Microsoft Store

Written 6 November 2026, from testing on this PC. Measurements used the app's real analysis code on four of the songs you tested: Cinnamon Girl, come on home, As You Are and Shameless.

## The short version

Everything on your list can be improved, and most of it can be fixed outright.

The biggest discovery: **Windows already knows what Spotify and YouTube Music are playing**, including the song's position. Your four test songs are also in your Music folder. So the app could recognise a streamed song, load the analysis of your local copy, line it up with what's playing, and give you local-file visuals during Spotify.

| What you reported                                | Cause                                                                     | Can it be fixed?                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Play button starts local songs over system audio | Bug: with no local song loaded, Play falls through to "start the library" | Yes, and Play and Skip can control Spotify                                                |
| System audio can't show the song                 | Not attempted yet                                                         | Yes, in the Windows app. Tested on this PC                                                |
| Live visuals are tamer                           | The song's shape is missing, and detail is noisy                          | Close to fully for songs you own, mostly for songs heard before, partly for first listens |
| Long names are cut off                           | A 16-character limit                                                      | Yes                                                                                       |
| Cut-off artist names                             | Most likely the player and title card text, fixed on `main` after v0.1.0  | Yes, in the next release                                                                  |
| Some songs show no words                         | Words wait for a detected drop. Slow songs have none                      | Yes. MP3 has nothing to do with it                                                        |
| Library should slide in at the left edge         | New feature                                                               | Yes                                                                                       |
| Microsoft Store                                  | Test package already built                                                | Yes, but it needs your account                                                            |

## What was measured

### Why live looks tamer

I ran each song through both paths, frame by frame. The expected answer was "live reacts less". The real answer is different.

**1. The song's shape is completely missing.** These signals drive the big changes in the visuals:

| Signal                                        | Live                    | Local file                          |
| --------------------------------------------- | ----------------------- | ----------------------------------- |
| `presence` (how big this moment is)           | Stuck at 1, never moves | Full 0 to 1 range                   |
| `world` (how the scene opens up)              | Stuck at 0              | Full 0 to 1 range, except Shameless |
| `tension` (the climb into a drop)             | Stuck at 0              | Up to 1, except Shameless           |
| Section memory (each part keeps its own look) | None                    | 4 to 8 distinct parts per song      |

**2. Detail is noisy, not weak.** Live finds too many hits, so everything looks equally busy:

| Song          | Snare hits, live vs local | Hat hits, live vs local |
| ------------- | ------------------------- | ----------------------- |
| Cinnamon Girl | 401 vs 81                 | 300 vs 176              |
| come on home  | 426 vs 163                | 459 vs 316              |
| As You Are    | 349 vs 100                | 352 vs 306              |
| Shameless     | 380 vs 48                 | 383 vs 288              |

Automatic gain also pushes bass and energy to the top of the range nearly all the time. That flattens the contrast between a quiet verse and a loud chorus.

**3. Drops are unreliable.** These are the moments that matter most:

| Song          | Drop impacts, live | Real drops |
| ------------- | ------------------ | ---------- |
| Cinnamon Girl | 0 (all missed)     | 3          |
| come on home  | 11                 | 1          |
| As You Are    | 41                 | 2          |

**4. Vocals are weak.** The vocal signal peaks at 0.3 to 0.5 live, against 1.0 with a score. The score uses the stereo centre to find the voice, and live analysis listens in mono.

**5. Timing is late.** Hits land about 33 to 50 ms late. Motion is about 250 ms behind, because a local song starts moving 220 ms early by design.

**6. Tempo can be wrong.** As You Are read 174 BPM live against 87 from the score, which is double.

### Can a streamed song be recognised?

Yes. This is what Windows reported on this PC:

```text
Spotify    The Let Out · J. Cole · The Fall-Off   position 4:06 of 4:14, artwork
Chrome     As You Are · The Weeknd - Topic        position 4:10 of 5:40, artwork
Resonance  come on home · Royel Otis              position 0:00 of 2:54, artwork
```

Windows can also tell those apps to play, pause and skip.

### Can a capture be lined up with a local copy?

Yes, on this test. I changed each song's EQ, halved its level and added noise, then searched for random clips in its score.

| Clip       | Search                          | Found within 0.3 s                    |
| ---------- | ------------------------------- | ------------------------------------- |
| 10 seconds | Whole song                      | 100% on three songs, 77% on Shameless |
| 5 seconds  | Whole song                      | 71% to 93%                            |
| 5 seconds  | Within 3 s of Windows' position | 100% on all four                      |

The typical error was a steady 0.2 s, which looks like a fixed delay that can be calibrated out.

**Limit of this test:** it used the same audio with changes applied, not a real Spotify capture. A different edit or master could do worse. This must be retested on real Spotify audio before building on it.

### Can a first listen be improved without any song data?

Partly. These results set the limits:

| Song          | Kick forecast 2 bars ahead (F1) | Part of the song that repeats |
| ------------- | ------------------------------- | ----------------------------- |
| come on home  | 0.87                            | 74%                           |
| As You Are    | 0.76                            | 66%                           |
| Shameless     | 0.43                            | 41%                           |
| Cinnamon Girl | 0.13                            | 61%                           |

- Forecasting works on steady drums and fails on loose ones, so it should only run when confidence is high. These figures used the song's own full analysis, so a real first listen would score lower.
- Snare forecasts were poor everywhere. Kick is the one worth predicting.
- 41% to 74% of each song repeats a part already heard, so the app can learn a song while it plays.
- A simple live estimate of `presence` from loudness was weak: correlation of -0.29 to 0.54 overall, and 0.30 to 0.77 after the first minute. Rebuilding shape live needs more than loudness.

### Words and lyrics

- All four test MP3s have **no tags at all** and no embedded lyrics. They look like YouTube downloads.
- LRCLIB has **time-synced lyrics for all 6 songs I tried**: your four, plus The Let Out and EARFQUAKE. It's free, needs no key in my test, and its server code is MIT licensed.
- Its timings came from other uploads, so they may not match your copy exactly: Cinnamon Girl is 301 s there and 296 s in your file.

## The plan

Sizes are relative: S is small, M is a few focused sessions, L is a large piece of work.

### Stage 1: Fix what's broken (S)

**Done** on branch `claude/stage-1-player-fixes`.

These need no research and can ship in the next release.

1. **Play button in live mode.** It must never start the library while system audio or tab audio is on. Until stage 3 it should say it's listening. Media keys get the same fix.
2. **Full names.** Drop the 16-character limit and let long names wrap onto two lines. The particle word currently draws on a single line, so it needs a two-line layout.
3. **File name order.** Untagged files named "Title - Artist" are read backwards. Use the library's other songs to spot which side is the artist. Your Tyler FLACs have correct tags, so this only affects untagged files.
4. **Words on every song.** Words currently need a drop, and tension is only calculated from drops, so a song with none never gets one. Fall back to the first big section change or first chorus.
5. **Library at the left edge.** Details are below.

**Library behaviour:**

- Moving the mouse to the left 12 px of the screen slides the library in after about 120 ms, so passing through doesn't trigger it.
- It stays while the mouse is over it and slides away about 400 ms after leaving.
- Opening it with the button or Q pins it open, as it works now.
- Mouse only. Touch screens keep the button.
- It stays hidden in Lounge mode, while recording, and when the UI is hidden with H.

### Stage 2: Microsoft Store (M, runs alongside)

Tested so far: a Store package built successfully from the current app, at 144 MB with Electron's `runFullTrust` capability. It hasn't been installed or run yet, because Developer Mode is off on this PC.

**You need to do:**

1. Create a Partner Center account. Microsoft says this is free for individuals, with ID and selfie verification. An older electron-builder page still says $19.
2. Reserve the name Resonance. It may be taken.
3. Turn on Developer Mode, so the package can be tested here. It's a Windows setting, so I won't change it for you.
4. Decide on a privacy policy page. I couldn't confirm whether it's required, but a stage 5 lyric lookup would make it wise.

**I would do:**

1. Add the identity values Partner Center gives you, and the required tile images.
2. Turn off `electron-updater` in Store builds, because the Store handles updates. Electron's `process.windowsStore` is the usual check.
3. Test System audio, the folder dialog, relaunch and file access in the packaged app. Store packages redirect some file paths, and I found nothing confirming how that affects this app.
4. Submit, then point the website link at the Store page. Keep GitHub as a fallback.

electron-builder's newer MSIX target is only in the version 27 alpha, so I'd use the stable `appx` target. Certification typically takes 1 to 3 business days, according to its docs.

### Stage 3: Now Playing (M)

**Built** on branch `claude/stage-3-now-playing`. It uses a small helper of our own rather than the package below, because that package can only watch sessions, not control them.

Windows app only, because a browser can't see other apps.

- Show the title, artist and artwork in the player and title card.
- Play, Pause, Next and Previous control Spotify or YouTube Music.
- Spell the real song name on big moments, and use the artwork for colours.
- Use the session that's actually playing, and clean names such as "The Weeknd - Topic".

**How:** `@coooookies/windows-smtc-monitor` is a Rust module for this. It must run in a worker because it can block the main process, and it needs checking against Electron 45. The fallback is a small helper program.

**Security trade-off:** the app has no bridge between the page and Node today. This needs a small one, limited to now-playing data and those few controls. The data never leaves the PC.

### Stage 4: Local-quality visuals for songs you own (L)

This is the biggest win for the songs you tested.

1. Match the Windows title and artist against your library.
2. Load or build that song's score.
3. Use Windows' position as a rough guide, then line up on the audio itself. Earlier research found media position alone can't be trusted as a sync clock.
4. Keep checking the alignment. If it drifts or the song is a different version, fall back to live smoothly.

**First step:** capture real Spotify and YouTube Music audio and repeat the alignment test. If that fails, this stage needs rethinking before any building.

### Stage 5: Better first listens (L)

These help everyone, including tab capture on the website.

1. **Clean up hits.** When the tempo is locked, reject hits that don't fit the beat. The target is live counts near the score's.
2. **Fix fake drops.** Only allow a drop after a real change in level and density, sustained across a bar.
3. **Keep contrast.** Slow the automatic gain so verses stay smaller than choruses.
4. **Hear the voice.** Split left and right live, so stereo centre finds vocals as the score does.
5. **Fix double tempo.** Check against the song's kick and snare pattern.
6. **Forecast the kick** when confidence is high, to recover the 220 ms lead on steady songs.
7. **Learn while listening.** Analyse the last minute or so in the background, spot repeats, and predict the next chorus the second time round.

Each step needs a measurable target. The bench behind this plan should go into `src/dev`, so every change can be scored on these songs.

### Stage 6: Real lyrics (M, optional)

- Look up synced lyrics for local and streamed songs.
- Spell real lyric words in time with the song, rather than only the title.
- Use repeated lines to find choruses before they happen, even on a first listen.

This is the one feature that sends data off the device: song title, artist and length, never audio. It must be opt-in and clearly explained, because "Your music stays on this device" is a promise on your start screen. Lyrics are copyrighted, so check this before shipping it widely, especially in the Store. Flashing single words carries less exposure than showing full lyrics, but that's my reasoning and not legal advice.

### Stage 7: Song memory (M, your decision)

After hearing a whole streamed song, keep a small map of it: tempo, beat grid, sections and drops. No audio and no melody. On the second listen, line it up and the song's shape is there, even if you don't own the file.

This is what brings shape to songs you don't own. It's also the riskiest legally, which is why it's separate. Earlier research found Spotify's terms ban recording and ripping, and Apple's rules ban software "measurement, analysis, or monitoring" of content. Storing a derived map isn't storing audio, but it does sit closer to those lines, and a Store app is more visible than a free website.

## How close this gets

| Situation                     | After these stages                                        |
| ----------------------------- | --------------------------------------------------------- |
| Streaming a song you own      | Should be close to local, if real-capture alignment holds |
| A song heard before (stage 7) | Most of the shape and timing, without melody detail       |
| A true first listen           | Clearly better, cleaner and more dynamic, but not equal   |
| Website tab capture           | Stage 5 only, with no song identity                       |

A first listen can't fully match a local file, because the score knows the future and live audio doesn't.

## Ideas ruled out for now

- **Live stem separation.** Browser versions process whole files, and one reports 3 to 5 minutes for a 4-minute song, with models of 84 to 333 MB. I found no real-time version.
- **Spotify's API.** Audio analysis has been closed to new apps since November 2024, and you've chosen to avoid that platform.
- **Delaying the sound to look ahead.** It's the only route to true first-listen foresight. Windows can capture a single app's audio, but this needs a native module, adds delay to every Play and Pause, and has real risks. Revisit it only if stages 4 and 5 fall short.

## Decisions for you

1. **Order.** I recommend stage 1, then 3, then the real-capture test for stage 4, with the Store running alongside.
2. **Lyrics.** Do you want an opt-in online lookup, given the privacy wording and copyright question?
3. **Song memory.** Do you accept that risk, or keep it to songs you own?

## Sources

- [Free Microsoft Store registration for individuals](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)
- [electron-builder MSIX docs](https://www.electron.build/docs/msix/)
- [electron-builder AppX docs](https://www.electron.build/docs/appx)
- [windows-smtc-monitor package](https://www.pkgstats.com/pkg:@coooookies/windows-smtc-monitor)
- [LRCLIB source repository](https://github.com/tranxuanthang/lrclib)
- [Online Score Following, WAC 2024](https://www.mit.edu/~mcaren/papers/Online_Score_Following___WAC_2024.pdf)
- [Windows process loopback parameters](https://learn.microsoft.com/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params)
- [Browser stem separation with demucs-web](https://github.com/timcsy/demucs-web)
- [Running stem separation in a browser tab](https://kitmul.com/en/blog/audio-stem-splitter-ai-source-separation-browser)
- [Spotify Web API changes discussion](https://community.spotify.com/t5/Spotify-for-Developers/Changes-to-Web-API/m-p/6543355)

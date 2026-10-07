# Hawk Racing trailer

`hawk-racing-trailer-1080p.mp4` (1920x1080, 30 fps, ~44 MB) and
`hawk-racing-trailer-720p.mp4` (~22 MB) are cut from a live four-car Grand
Prix rendered by the game itself (`src/trailer.js`). The same trailer plays
in the game from the garage: **Trailer** button or the `T` key.

Music: *Full Throttle Apex* (from 1:40.5), fades in and out.

## Re-recording

1. `npm run dev`, open the game at a 1920x1080 window, get to the garage.
2. In the browser console:
   ```js
   __nh.rec.begin();          // starts the trailer, High quality, 1x pixel ratio
   __nh.rec.chunk(80);        // repeat until it returns state: 'menu'
   ```
   Frames are written to `trailer/frames/` by the dev server (`vite.config.js`).
3. Encode:
   ```bash
   ffmpeg -framerate 30 -i trailer/frames/f%05d.jpg -ss 100.5 -t 37 -i public/audio/full-throttle-apex.mp3 \
     -map 0:v -map 1:a -c:v libx264 -preset slow -b:v 10M -maxrate 14M -bufsize 20M -pix_fmt yuv420p \
     -movflags +faststart -c:a aac -b:a 192k -af "afade=t=in:st=0:d=0.6,afade=t=out:st=34.6:d=2.4" \
     -shortest trailer/hawk-racing-trailer-1080p.mp4
   ```
The race is live, so every take differs slightly.

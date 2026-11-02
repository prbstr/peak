# senses

Fast local loop on the Mac. Not wired yet — fill in at M3.

- `vision.js`: read the UDP H.264 stream from the node (`ffmpeg -i udp://0.0.0.0:5000 -vf fps=2 -f image2pipe -`), send a frame to a local vision model via Ollama (`llava-phi3` or `moondream`), publish `peak/<node>/event` `{"see":"a person waving"}` when the scene changes.
- `hearing.js`: USB mic on the Pi streams audio, or record on the Mac; run whisper.cpp / mlx-whisper; publish `{"heard":"hey peak, wave"}`.

Only publish events, never raw frames, to the orchestrator — the mind thinks on events.

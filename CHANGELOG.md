# Changelog

This file is maintained between releases and should be updated as work is completed.

## Unreleased

- Refocus Music Control Center as an external-only AutoDJ controller: preserve Twitch and online request playback, route owned requests through standalone AutoDJ, require acknowledged takeover leases before player loads, and remove the embedded analyzer, decks, mixer, transition engine, routes, assets, and packaging resources.

- Keep the normal OBS music source on the classic compact player for both Center and standalone AutoDJ playback, while leaving the large AutoDJ performance output as an explicit scene-only option.
- Preserve the standalone AutoDJ process, pairing, and network listeners when promoting a Control Center build, while still refreshing the classic OBS source.
- Make the Music Control Center the live authority for standalone AutoDJ: the AutoDJ switch now stops one engine before starting the other, guards both paths when synchronization is uncertain, and preserves viewer-request takeovers.
- Provide one stable OBS music loader that follows Center, viewer-request, and standalone AutoDJ authority automatically, with the AutoDJ browser-output address learned during pairing.
- Add a clear on-air authority rail to the AutoDJ desk, showing Normal Center, AutoDJ, guarded state, viewer-request takeover, and the single OBS output.
- Stop the Control Center's internal deck as soon as an external AutoDJ is selected, and skip its local-library/AutoDJ startup work in external mode so pairing cannot leave two DJs playing or freeze the request-player UI.
- Keep the Control Center responsive during background AutoDJ work by keeping watched-folder scans on one persistent background worker, avoiding empty durable scan writes, using lightweight playback safety checks, skipping unchanged cached-analysis passes while live playback has paused speculative work, and avoiding unnecessary full-library request-index rebuilds.
- Defer private-network discovery until Search local network is pressed, avoiding a Windows network-access prompt after routine promotions and launches.
- Pair the Control Center and standalone AutoDJ through an incoming Accept or Decline popup, with the approved engine address and private pairing credential saved automatically and no credentials broadcast.
- Resume an owned request directly after restart when its persisted deferral count proves the one allowed opener already played, preventing an idle loop of unnecessary startup searches.

- Added private-LAN discovery for standalone AutoDJ engines, with a Search local network control that fills and autosaves the discovered engine address without broadcasting API tokens.

- Route a tempo-distant owned request through at most three safe, early-exit filler tracks that move monotonically toward its BPM, while keeping the request at queue head with a ten-minute target and starting it directly after EOF as the fail-safe.

- Start an already-owned viewer request directly after a natural AutoDJ EOF, instead of leaving playback idle while searching for an unnecessary bridge opener.

- Treat an exact Punch/drop ownership transient inside the final live level and bass reserve as an intentional musical handoff instead of a false abrupt-gain failure.

- Keep native sidecar initialization asynchronous while allowing stream-PC startup hydration up to 45 seconds to deliver the exact readiness and health fences.
- Compare up to sixteen seconds of memory-only cue audio before launch so a sparse or misleading opening cannot hide a sustained half-beat basin later in a 32-beat transition.
- Prefer a strongly repeated cue-local half-beat kick over a competing small clap alias during native prelaunch alignment, include the observed 304-307 ms attack basin on slower masters, and let an independently repeated broadband half-beat repair tempo-changing transitions while low-band-only stretched subdivisions remain rejected.
- Require automatic transitions to remain inside the exact cue-window level and bass limits at final arm and commit, while continuing to prefer candidates with extra live-render reserve during selection.
- Extend strongly repeated cue-local half-beat repair for slower tracks so mastered 128 BPM kick basins up to 300 ms away are corrected before launch.

- Ignore a single acoustic review window that jumps to a remote beat subdivision instead of misreporting its non-linear phase hop as real tempo drift.
- Correct strong 128 BPM half-beat launch aliases even when mastering shifts the repeated kick or clap attack slightly ahead of the mathematical half-beat point.
- Correct repeated half-beat launch aliases against the cue-local beat period instead of letting a conflicting fine-envelope attack override the completed-render evidence.
- Release temporary sparse-intro bass fill at the fast incoming-rise rate when the mastered bass arrives, preventing a boosted drop from becoming a low-band clash.

- Apply a small high-confidence acoustic phase repair when both the armed and cue-local previews independently measure the same offset, while still rejecting changed or neighboring beat subdivisions.

- Rotate strict startup candidates across the complete safe batch and widen normal compatible-track randomization to 128 choices, reducing repeat-heavy restart sequences without weakening tempo, key, or transition checks.

- Release temporary overlap fill gradually under limiter pressure and retain only limiter-aware low-band fill, preventing Punch handoffs from collapsing level and bass together into an audible step.

- Judge deliberate overlap tempo corrections by the repeated rendered acoustic lock, and recognize an exact limiter-safe chaotic Punch ownership event even when the structural analyser labels its drop as a generic phrase, while still rejecting weak audio evidence and unsafe gain jumps.

- Recheck the final four-second acoustic preview as two repeated render windows, allowing a strongly verified 90-120 ms phase repair and a bounded overlap-only tempo correction; if cue-boundary PCM is inconclusive, retain only a strongly repeated armed preview phase up to 60 ms and never its stale tempo estimate.

- Keep measured positive level and bass fill responsive through the final ownership handoff, while negative trims still use that runway to release, preventing a sparse intro from opening a brief gap just before the new deck becomes solo.

- Let a strongly verified cue-local phase measurement replace the complete bounded learned jog before launch, rather than leaving an audible offset when the stale jog and measured grid phase point in opposite directions.

- Let the native overlap controller restore more measured full-band and bass weight only while a handoff is genuinely sparse, with limiter-aware backoff, and widen the persisted random-selection window so restarts draw from more of the compatible crate.

- Use the same render-chunk acoustic model before launch and after completion, and correct the remaining error after any planned phase nudge, preventing tempo-processed kick or clap phases from passing one verifier but failing the other.

- Recheck acoustic beat phase from cue-local outgoing audio immediately before a transition starts, so an early armed preview cannot lock a later locally corrected beat grid to the wrong phase.

- Apply a bounded strongly verified 60-90 ms intrinsic beat-grid correction while keeping larger subdivision aliases diagnostic-only.

- Align live transitions to the repeated kick/clap attack even when rolling bass dominates the preview, and allow a small high-confidence pre-audible jog when bass and percussion disagree.

- Prefer a later cue on the same track when a low-confidence phrase grid has attacks but no strong local four-beat pulse consensus, preventing a musically ambiguous entry from reaching the live acoustic verifier.

- Skip only a locally pulse-ambiguous incoming cue and continue to a stronger 16/32-beat entry on the same track, preventing a trusted whole-track grid from masking a sparse intro that cannot be acoustically aligned.

- Vary automatic selections across the best 24 tempo/key/planner-compatible tracks and persist a 50-track song-family cooldown, preventing restarts and deterministic rank-one choices from recycling the same small cluster.

- Keep tempo-return source clocks ordered through overlap-only acoustic pitch bends, retry one early inconclusive acoustic preview before launch, expose stable audible phase aliases to quality review, prefer cue windows with real live level/bass reserve, and add compact pulse/bass/transient evidence for cue and drop ranking.

- Recover a naturally ended AutoDJ deck immediately from its compatible analyzed warm pool, preventing strict cold-start reservation retries from leaving the stream silent after a missed transition.

- Restart only an unarmed AutoDJ planning pass when live transition settings change, so the selected mode takes effect without waiting for a later manual Save while active and already prepared mixes remain untouched.

- Speed up background track analysis by reusing its existing harmonic structure pass for key detection, trusting an agreeing Traktor BPM instead of repeating full-track tempo estimation, and running only coarse bar features at the standalone AutoDJ analyzer's lower sample rate while retaining full-resolution Beat This grid refinement.

- Give the OBS AutoDJ scope the dense filled waveform, beat/phrase/drop grid, white playhead, and compact live position readout used by the standalone AutoDJ deck view.

- Prevent native AutoDJ mixes from being cancelled at their cue when a delayed browser timer races the native sample-clock start event.

- Make post-transition acoustic review subtract low-band power from its percussion lane so rolling or reverse-bass subdivisions cannot masquerade as a stable beat offset.

- Keep every live acoustic phase jog within 60 ms, preventing a stable neighboring EDM subdivision from turning an otherwise close beat grid into a larger audible offset.

- Ignore impossible acoustic drift when short transition windows lock onto different kick, clap, or reverse-bass subdivisions, keeping an exact native grid from learning a false beat offset.

- Keep a measured louder-arrival cut through the exact ownership frame and release it smoothly on the new solo deck, preventing the protected level from jumping back up at the end of a transition.

- Let a strongly repeated broadband kick or clap authorize a small prelaunch beat jog when an ambiguous rolling bass tail disagrees, while still rejecting weaker reverse-bass phase aliases.
- Back off temporary overlap fill quickly when the incoming track reaches a measurably louder section, preventing a sparse intro from turning into a level spike while leaving the new solo track at its normal gain.

- Made native beat verification reject cross-band-ambiguous prelaunch jogs, use repeated acoustic phase across transition windows so one kick/clap subdivision cannot masquerade as tempo drift, and apply a bounded overlap-only DJ pitch bend when both rendered bands reveal real grid-speed drift before returning the incoming deck to its intended solo tempo.

- Anchor acoustic beat verification to the strongest repeating kick or onset near each analyzed beat, compare low-band with low-band and broadband attacks with broadband attacks across decks so a reverse-bass tail cannot be paired with a kick, allow only cross-band-consistent phase evidence to use the bounded 120 ms jog range, rebase the native grid clock and rendered residual by the correction already applied before launch, and distinguish sample-clock grid lock from acoustically verified beatmatching.
- Give short and medium transitions a proportional measured-fill window, carry only a measured positive level or bass fill across the exact ownership frame, and release it smoothly on the new solo deck, so the fixed six-second return no longer consumes an entire 16-beat overlap or recreates the corrected hole at commit while negative cuts can never leave a track pushed down.

- Keep background library analysis moving past stale Traktor file paths without calling them analyzer failures, retry genuine per-track analyzer errors once, retain bounded failure diagnostics, and report paused workers truthfully while active work finishes.
- Keep direct YouTube requests named from an explicit upload title instead of unrelated provided-track metadata in the description.
- Keep background library analysis accepting FFmpeg's valid loudness report when malformed embedded cover or Traktor metadata contains unmatched braces.

- Keep an early `!skip` request pending through AutoDJ handoff and candidate search, then advance at the next viable analyzed 16/32-beat exit instead of silently dropping the command.
- Report an in-progress AutoDJ advance truthfully when `!skip` lands between track ownership updates, instead of claiming that nothing is playing.

- Resume AutoDJ after the final normal request ends, even when that idle event arrives while the guarded request-start operation is still settling.

- Match watched-folder DJ masters that add collaborator credits to a requested lead artist, while retaining exact artist-collision protection.

- Recognize a bounded one-window level rise at an exact Punch drop as musical ownership rather than a gain fault only when the full envelope stays level-safe, the bass handoff lands on its exact frame, and the limiter remains quiet.

- Prefer the exact 16/32-beat cue, next-track candidate, and bounded layer/EQ shape with the largest measured live-render level and bass reserve, reducing underestimated stereo valleys without blocking continuous mixing when only an outer-limit-safe pair exists.

- Keep an owned watched-folder request durable until its startup load passes the final playback-authority fence, and return it to the queue if audio fails before confirmation.

- Cap overlap-only full-band fill at 1.5 dB while leaving the remaining shared reserve for bass correction, keeping sparse handoffs full without excessive whole-mix gain movement.

- Recheck the complete viewer-request queue after every watched-folder scan, even when no catalog metadata changed, so a newly reachable local copy can still replace the queued online track.

- Judge transition limiter stress from its sustained 95th-percentile attenuation while retaining a six-decibel transient ceiling, so isolated peaks do not trigger extra overlap ducking or make otherwise full mixes sound thin.

- Return overlap-only level and bass correction to each incoming track's authored solo gain with a deadline-scaled six-second glide before transition commit, preventing a briefly thin or pushed-down deck and avoiding a correction step stacked onto the musical handoff.

- Keep watched-folder rescans and queued-request matching alive while background analysis is paused for live playback, and let an exact queued match use the existing priority analyzer lane.

- Keep planner and renderer loudness metadata identical, share one bounded low-band fill reserve, and release overlap fill in proportion to limiter pressure so the incoming track neither stays pushed down nor changes level abruptly.

- Recognize a smooth, limiter-safe rise from a quiet outgoing tail into a normally normalized incoming owner, avoiding quality feedback that would otherwise keep the new track unnaturally quiet.

- Smooth and cap overlap-only level and bass correction so sparse handoffs stay full without pumping or leaving the incoming track attenuated after ownership.

- Fit overlap correction to the deck that is measurably causing a loud arrival, react faster to sparse handoff valleys, and discard every adjustment at ownership so transitions stay full without leaving the following track pushed down.

- Reserve just over one decibel of overlap-only transient headroom when two full layers coincide, keeping the fuller adaptive level and bass fill without audible limiter pumping or changing the following solo track's gain.

- Use the native output-headroom reserve for measured overlap-only level and bass fill, preventing sparse 16-beat handoffs from sounding hollow while still restoring the incoming track's authored solo gain and EQ.

- Keep endpoint-drop plans accountable to the established track's real preroll and cap overlap-only full-band cuts, preventing an outgoing lift from being mistaken for safe ownership and then thinning the whole mix.

- Keep the established track full through a measured sparse intro and hand ownership over at the incoming drop, preventing drop-ending transitions from sounding thin or leaving the next track pushed down.

- Use the remaining limiter reserve for stronger bounded overlap-only level and bass fill when a sparse incoming cue sounds thin, then restore its authored solo gain and EQ at commit.

- Reserve at most half a decibel of shared overlap headroom for correlated transients, avoiding limiter pumping without bringing back the old multi-decibel transition duck.

- Start overlap-only level and bass fill earlier on a developing quiet valley while retaining the wider loud-side cut threshold, smoothing short transitions without holding energetic tracks down.

- Wait for rendered overlap evidence before applying correction, pull excess only from the departing deck, exchange Punch bass ownership over one complete beat, account for linked-limiter reduction before adding bounded fill, and discard every overlap correction at handoff so consecutive incoming tracks cannot stay compressed or tonally thin.

- Judge Punch bass collisions only before the exact low-end ownership handoff, so a new track's legitimate drop no longer causes unnecessary persistent attenuation.

- Preserve the established deck at full level while fitting layered incoming audio into a bounded two-decibel overlap budget, and let overlap-only bass fill use that reserve when a measured cue would otherwise sound thin.

- Compare complete one-second energy windows at the start of a transition, preventing ordinary kick placement from being misreported as an abrupt gain or bass step while retaining sustained dip, spike, and limiter checks.

- Smoothed Punch bass ownership over the final half beat while preserving its exact downbeat endpoint, preventing an otherwise balanced transition from making one abrupt level and low-end step.

- Kept combined bass energy constant during ownership exchange instead of amplitude-crossing both low shelves into a thin midpoint.

- Keep AutoDJ transition gain and bass correction overlap-only while allowing it to gently fill a measured handoff hole through the endpoint, preventing thin or pushed-down mixes without changing the incoming track's solo loudness or EQ.

- Reuse identical cue-window continuity proofs and short-circuit handoffs that remain too quiet at full incoming gain, keeping wide analyzed next-track scans responsive without reducing their breadth or relaxing level and bass safety.

- Smoothly self-correct only cue-local level or bass errors outside the accepted transition window, keeping the adjustment small, rate-limited, and overlap-only so it cannot duck the mix or leave the incoming solo track thin; also use full-band percussion as a prelaunch beat anchor when an intro has no reliable kick.

- Validate live beatmatching from bounded in-memory acoustic energy, including sparse-transition fallback, while retaining only 2,000 aggregate evaluations and never writing transition audio captures to disk.

- Cross-check stale Traktor Auto-Gain values against complete LUFS and true-peak analysis, preventing multi-decibel level swings while retaining measured peak headroom and analysis-only request normalization.

- Require repeated or strongly bounded local acoustic evidence before reporting or learning an audible beat offset, so a single half-beat bass alias cannot override an exact native sample-clock grid.

- Prefer an intact future phrase over a measured fade-tail phrase in exact-grid fallback mixes, while retaining the fade tail as a last-resort exit when no intact phrase remains.

- Ramp a layered incoming deck over a full beat on short transitions, reducing the isolated level step caused by reaching its 80-90% blend level too quickly.

- Replace an unstarted native transition whose server-owned prepared payload has already been cleared, preventing an orphaned incoming deck from blocking every later safe AutoDJ plan.

- Kept layered AutoDJ overlaps from ducking by up to 3 dB under a quieter incoming cue, using the existing limiter headroom and the same bounded one-decibel overlap trim in planning, browser, and native audio.

- Keep medium matched-bass drop handoffs isolated so cue-window optimization cannot expose two nearly equal basslines to cancellation and a sharp low-end jump.

- Kept an intentional native transition reload from reporting its cancellation as a real AutoDJ failure, so mix-next can replace a buffered cue without orphaning the replacement deck.

- Clear an incoming native deck if its asynchronous preparation finishes after the server has cancelled that transition, so a fast skip or replanning pass cannot strand AutoDJ behind an `already prepared` collision.
- Keep beatmix handoffs away from incoming phrase boundaries that sharply withdraw energy, choosing another stable 16/32-beat entry on the same track instead of creating a level and bass dip.
- Keep exact-grid rescue mixes inside the measured level and bass limits, and project sparse analyzer envelopes onto nearby four-beat grid exits instead of bypassing a warning through whole-track loudness.

- Keep the dashboard and playback API responsive while selecting the next track by applying the existing 20/100-row transition budgets before expensive musical planning and yielding between plans.

- Prefer a strong measured outgoing phrase as well as a strong incoming entry for exact-grid fallback mixes, avoiding level and bass holes caused by otherwise aligned breakdown exits.

- Prefer the strongest measured exact-grid entry among viable 16/32-beat phrases, avoiding silent pickups that could create a large level or bass hole before the incoming landmark.

- Ramp a newly layered deck over its opening beat and keep two-deck overlap at constant power, reducing abrupt level steps and sustained limiter load without moving the beatmatched cue.

- Use a later exact 16/32-beat grid exit when an analyzed cue has already passed, retaining strict phase and rehearsal checks while reserving conservative incoming ownership for unmeasured late cue windows.

- Keep Chaotic/EDM AutoDJ continuous when no trustworthy drop label exists by using an exact tempo/key-compatible 16/32-beat phrase-grid escape only after drop-ending plans fail, and require measured cue-window level/bass continuity rather than guessing from whole-track loudness.

- Model the incoming landmark's first solo window during drop-ending transitions, and reserve conservative level/bass headroom when that drop window is not measured, preventing quiet buildups from turning into large post-handoff spikes.

- Rotate automatic selection away from a candidate whose only safe mix point would play merely its final tail, while preserving viewer-owned requests through their existing must-play bridge path.

- Keep large cached next-track previews responsive by recording the selected result instead of serializing a full diagnostic payload for every in-memory rejection.

- Let Chaotic/EDM AutoDJ leave a fixed-tempo deck on an exact 16/32-beat grid phrase when its outgoing semantic label is missing, while still requiring the incoming overlap to end on a detected drop.

- Keep active native AutoDJ handoffs alive across brief OBS reconnects, retain rendered quality, prevent the following transition from racing the still-finishing deck, move armed skip cues without changing their mix profile, rebuild phrase/phase/bass/level evidence at the exact moved cue instead of forcing an unmeasured boundary, explicitly reload only when a shortened 16/32-beat skip changes the native decoder contract, prefer useful early incoming entries in every mix style, and keep large cached-successor scans responsive.

- Refine changed-tempo AutoDJ matches once before they become audible, use kick evidence to correct bounded grid offsets, and learn both phase and tempo drift while clearly distinguishing acoustic evidence from grid-only quality scores.

- Kept different-tempo AutoDJ waveform previews on the exact prepared native deck phase and rate through the B-to-live handoff, preventing the visible jump and catch-up drift while preserving fixed-tempo overlap beatmatching.

- Align the OBS waveform and beat pills directly to the native audible sample clock, removing the tempo-dependent extra visual delay of almost one beat.
- Raise analysis-only AutoDJ tracks to the collection's measured loudness while retaining true-peak and limiter protection, preventing quieter Suno and local requests from playing noticeably below Traktor tracks.

- Reserve the first AutoDJ track's immediate mix partner during startup while keeping normal one-track-at-a-time selection and avoiding an overnext lookup.

- Keep Hardcore and Speedcore tracks on a 150+ BPM full-time analysis grid so half-time detections cannot place 250 BPM music into a 125 BPM mix.

- Hold both decks at one fixed matched tempo for the entire audible overlap, rejecting any native transition whose outgoing Tempo Flow would continue underneath it and starting the incoming return only after the mix is complete.

- Reset the overlay's eight beat-marker pills at the same measured phrase origin as the waveform, so phrase beat one no longer displays as beat eight.

- Keep each overlay waveform and phrase lattice on its native deck's instantaneous effective tempo through a different-tempo handoff and Tempo Flow return, preventing B from rescaling, jumping, and drifting after it becomes live.

- Align the overlay's 16/32/64-beat phrase markers to the same repeated structural origin used by the transition planner, correcting tracks such as `Symphony of Boreal Wind` whose stable beat grid begins one four-beat block before the authored phrase lattice.

- Keep a track with no trusted phrase-origin estimate on its observed beat-grid lattice instead of treating every selected cue as phrase zero, so the planner tries another entry when the overlay exposes a one-bar 16/32/64-beat mismatch.

- Bound stream-PC deployment storage by retaining only the newest rollback sets and pruning only stale AutoDJ portable, NSIS, and analyzer temporary directories while protecting the active app extraction.

- Learn a conservative per-track beat nudge from one long, strongly correlated transition window when the native grid is exact but the audible kick lands slightly late or early, including tempo-return mixes.

- Keep an incoming waveform on its exact native track clock when it becomes the live deck, preventing a brief backward jump and slow visual catch-up across the handoff.

- Make every layered EDM transition finish exactly on the incoming track's detected drop, rejecting generic repeated phrase endings while retaining instantaneous drop slams.

- Evaluate the ranked 20-track analyzed cache in memory after a weak next-track pick, then source-check only a viable replacement so AutoDJ can reach later safe rows without consuming the outgoing track's final phrase.

- Kept Chaotic phrase-to-drop mixes on the exact 16/32-beat authored buildup instead of treating a much earlier repeated phrase cycle as the same landing.
- Required Chaotic drop slams to share a proven analyzed 32-beat arrangement phase, falling forward to a blended EDM transition when an instantaneous cut would be structurally ambiguous.
- Let Chaotic breakdown underlays use an analyzed pre-drop buildup so the outgoing breakdown and incoming track reach their authored payoffs together.

- Make EDM buildup swaps end exactly on both detected drops, using 4/8/16 analyzer measures for the public 16/32/64-beat overlaps instead of accepting an earlier repeated phrase cycle.

- Prefer Chaotic EDM pairs whose outgoing and incoming overlaps both end on authored arrangement landmarks instead of a slightly louder generic phrase pair.

- Interpret AutoDJ's short, medium, and long transition counts as 16, 32, and 64 beats across planning, admission, learning, playback, and the transition lab, and show the waveform as four-beat blocks so every overlap uses the same DJ count.

- Keep AutoDJ skip controls available before a mix is prepared, cancel a stale search, and arm the next viable 16/32-bar transition instead of hard-skipping or doing nothing.

- Show labeled 16-, 32-, and 64-beat phrase boundaries independently on both live overlay waveform lanes so large-section alignment is visible before and during a mix.

- Keep native PCM rendering fed while a completed transition's level and bass quality envelopes are finalized, preventing a brief audible dropout as the following track is prepared.

- Apply Smooth's authored 32-beat drop-landmark preference to Adaptive and Chaotic blends while preserving each style's transition strategy and rejecting generic phrase entries when a proper landing is available.

- Move repeatedly detected pre-drop fill bars onto the following authored 32-beat landing when beat one is ambiguous, including existing cached analyses, so otherwise compatible tracks no longer mix one bar early.

- Keep the dashboard and control API responsive during library analysis by applying completed jobs one per event-loop turn, incrementally extending the supplemental request index, and time-slicing full collection-index refreshes.

- Measure each native deck's audible kick/onset timing against its analyzed grid, show the signed beat error in Transition Lab, and learn a bounded per-track/cue phase correction from high-confidence completed mixes while keeping manual corrections authoritative.

- Correct ambiguous hardstyle beat grids when a louder reverse-bass tail masks the true kick attack, and selectively refresh affected cached analyses without discarding the rest of the analyzer cache.

- Align 16/32-bar mixes to repeated intro, post-intro, drop, body, and outro landmarks when an ambiguous track begins with a pickup, instead of forcing every weak phrase estimate onto bar zero.

- Normalize LUFS-only tracks, including generated Suno requests, to the configured rendered-output target after master headroom instead of leaving them roughly 3 dB too quiet.

- Kept different-tempo overlay waveforms on the native two-deck source clock during transition handoff, preventing the incoming lane from jumping and drifting against a server timestamp.

- Keep ambiguous phrase novelty—including existing cached final0 cues—on the authored 32-beat downbeat lattice instead of promoting a weak one-bar offset into a trusted transition alignment.

- Replace an armed raw Traktor-grid mix with its completed analyzer grid before the cue, and infer the 32-beat phrase origin from repeated eight-bar boundaries so isolated fills cannot shift a transition by one full bar.

- Prefer an earlier aligned rhythmic entry over a louder late phrase when grid-backed or completed analyzer planning would otherwise skip most of the incoming track, hand solo and bass ownership into the strongest following phrase instead of a breakdown, preserve its intended residency, and carry exact cue-window measurements into the best bounded level and bass shape.

- Apply the cue-window model's best bounded layer and bass shape even when the pair remains below the automatic quality threshold, reducing unavoidable level and bass holes without weakening the safety verdict.

- Finish a compact deck's post-overlap Tempo Flow before its next 70%-residency grid exit, preventing the outgoing rate from drifting a following 16/32-bar beatmatch by several beats.

- Keep every automatic track through at least 70% of its source, regardless of length or mix style, and keep viewer requests through their 75%/four-minute target before choosing the next valid 16/32-bar grid exit.

- Wait for the active native overlap to finish before emitting the following deck's prepare command, preventing an A-to-B crossfade from cancelling B-to-C with an outgoing-identity mismatch while still arming the next grid mix immediately after completion.

- Keep the random whole-collection tempo/key choice even when semantic analysis is slow or inconclusive, deriving its entry and the current deck's exit from their exact 32-beat phrase lattices, preferring 32 bars with a 16-bar fallback, preserving the 70% automatic / 75% requested-track residency floor, and immediately repeating the same one-track process after every completed transition instead of stopping behind an analyzer-upgrade latch.

- Analyze a trusted startup opener and its single tempo/key-compatible next track concurrently, keep that chosen record across retries, hold long automatic tracks for at least 70% and viewer requests for at least 75% of their source before a late grid-backed exit, and arm native transitions early so the sample clock starts them exactly even if an overlay timer stalls.

- Recover a completed native AutoDJ crossfade after an OBS overlay reload without leaving the silent outgoing deck as playback owner or blocking the next mix.

- Choose each automatic next track from the whole enabled collection by similar tempo and compatible key before analyzing its 16/32-bar entry, instead of limiting selection to the small pre-analyzed cache.

- Plan only a small yielding slice of same-tempo/key candidates per live deck, keeping transition commits and the control API responsive instead of exhaustively processing a twenty-track cache window on the main event loop.

- Keep background analysis and full collection-index rebuilding off the live AutoDJ event loop so a long armed track cannot miss its 16/32-bar cue and hard-advance at EOF.

- Keep a clean same-tempo/key 16/32-bar phrase mix eligible when its only missing evidence is an exact cue-window loudness envelope, using track loudness, EQ, and limiter shaping instead of dismissing the record and hard-advancing.
- Keep the chosen same-tempo/key track but prefer an earlier safe analyzed phrase whenever a later entry would discard most of it, giving short records roughly two-thirds of their runtime and long or requested records up to four minutes before their next exit.

- Re-arm an unconfirmed local track once when the authoritative native player reports both decks idle, and let the trusted playback-confirmation watchdog advance cleanly instead of leaving a silent provisional track stuck on screen.

- Join adjacent analyzed 16-bar sections into a stable 32-bar exit before giving up on a track, while still rejecting any runway whose quieter half loses its beat foundation.

- Prefer about four minutes of solo ownership for long Smooth tracks and viewer requests, falling through to the final intact analyzed 32/16-bar grid phrase when earlier semantic exits would cut the record short without ever making an unusual track ineligible; also align ambiguous 4/4 material with a full 32-bar phrase instead of risking a one-bar-shifted 16-bar mix, and reject entries whose bass or level spike is only exposed by the quiet side of the outgoing preroll.

- Choose same-tempo/key tracks one deck at a time from their real analyzed 16/32-bar entries, including the first startup deck; never require a speculative overnext track or dismiss an otherwise clean next track because a synthetic future-exit probe, non-ideal section label, or modest level/bass handoff is imperfect, preserve real cue-window evidence when structural labels are synthesized, accept exact zero-offset beat-led phrases even when global phrase confidence is conservative while still rejecting measured four-beat shifts, and snap short-track solo residency to a complete analyzed 32-bar phrase instead of missing its way out at an arbitrary wall-clock cutoff.

- Search a wider analyzed successor cache and plan candidates before source validation, avoiding cold AutoDJ analysis and mapped-drive checks when a strict B-to-C handoff is already available.

- Keep a retained AutoDJ entrance's free successor-analysis worker filled through its bounded four-candidate budget before rotating to another entrance, avoiding cue misses behind one slow sibling analysis.

- Time native AutoDJ cue starts from the authoritative audible deck clock, preventing a server timeline lead from canceling an otherwise ready 16/32-bar transition before its real cue.

- Collect the bounded analyzed replacement set before giving one runway-ranked incoming deck the successor search, preventing repeated B-to-C cache scans from consuming the current track's legal mix cue.

- Run the native AutoDJ engine and its decoder above background analyzer priority, retaining watchdog recovery while preventing concurrent track analysis from starving live audio control.

- Keep one maximum-runway AutoDJ successor analysis while using the second worker for a bounded 300-360 second candidate, avoiding two simultaneous long CPU analyses that can both finish after the outgoing cue.

- Model the full layered post-handoff release before arming AutoDJ, rejecting mixes whose quieter incoming deck would create a sustained level or bass dip between otherwise-safe endpoints.

- Start the single runway-ranked B-to-C successor search before scanning every normal warm entrance, so a chainable transition is not delayed past its cue.

- Replace an automatic trusted-grid opener immediately when its v16 upgrade exceeds the foreground analysis budget, instead of leaving the unverified deck fenced until a hard advance at EOF.

- Prefer a reachable long v16 opener over a raw trusted-grid deck when startup successor search exhausts, so AutoDJ can begin safe active-deck chain discovery immediately instead of waiting through an unbounded outgoing analysis upgrade.

- Rotate bounded cold successor analysis to another retained safe entrance after one unsuccessful two-worker wave when that alternate still has full analysis runway, so a second long wave in one incompatible neighborhood cannot consume every mix cue.

- Refill either freed successor-analysis worker immediately for the same recovery entrance, inspect the full 20-track ready next-track batch before cold work, keep each analyzed successor with its exact entrance, and transfer an expired entrance to a later safe one so slow or unsafe candidates cannot make the remaining mix cue expire.

- Use both existing analysis workers for one runway-ranked recovery entrance, keep each successor fenced until its real lease settles, and still attach an already-analyzed successor after the cold-work deadline so one bad candidate cannot make every remaining mix cue expire.

- Give the best strict 16/32-bar trusted-opener recovery entrance—warm or newly analyzed—exclusive ownership of its next-track reservation, retain it until that reservation finishes, and allow the stronger safe beatmix so AutoDJ does not run the current track to its end.

- Leave a planner-unmixable trusted opener through one pre-armed 16/32-bar recovery overlap with a strict analyzed next-track reservation, including an already-deferred exact request, while retrying rather than arming an invalid or expired overlap or giving a fresh request the recovery bypass.

- Finish an already-admitted deterministic v16 opener scan against the absolute playback deadline instead of abandoning its safe cached result when the trusted-grid reserve boundary passes.

- Search the full bounded 20-track ready-analysis window during normal playback, retain every safe 16/32-bar entrance while its required successor finishes analysis, and retry unusable late opener upgrades instead of letting the current track run out.

- Release the active AutoDJ planning pass as soon as a B-owned successor analysis lease is accepted, retaining its safe A-to-B geometry and retrying immediately when the late v16 result becomes reusable instead of waiting through the last legal cue.

- Batch each proposed incoming deck's ready v16 successor search so repeated full-library scans cannot consume the outgoing deck's final legal mix cue.

- Give a clean retained AutoDJ entrance one deadline-bounded priority successor analysis when no compatible cached next deck exists, rechecking the exact lease-time runway, continuing past pre-lease source misses, and reusing the same corrected 16/32-bar geometry after every wait instead of letting the safe mix expire.

- Rank one bounded batch of distinct ready v16 transition candidates before starting cold analysis, so cached fades or dead ends cannot consume a current deck's remaining mix runway through repeated full-library selection.

- Reserve a bounded startup slice for trusted-grid recovery when cached v16 openers have no safe successor, and evaluate its deterministic batch in 32-row controller pages that continue past fully filtered rows so later safe fallbacks remain reachable.

- Keep the cached v16 startup lane ahead of the much larger trusted-grid recovery scan and yield its deterministic batches, preventing catalog work from consuming the audible-start deadline or blocking controls.

- Evaluate the first 20 indexed startup-opener rows and their in-memory successor proof before yielding to unrelated catalog work, reaching a safe row 17 while keeping larger results responsive in 20-row slices.

- Retry a trusted-grid opener's exact v16 upgrade when the priority analyzer temporarily returns without accepting work, instead of leaving AutoDJ fenced until the track ends.

- Stop repeated startup-cache event-loop handoffs once the first handoff is already delayed, and reject strict dead-end openers before mapped-drive validation so trusted recovery remains inside the audible-start deadline.

- Start guarded cached AutoDJ playback independently of slow Twitch connection and redundant cache refreshes once an authority and hydrated analysis cache are ready, while fencing configured category suppression to the latest resolved settings revision and handling Twitch failures without blocking the empty-policy fast path.
- Refresh the OBS local-file Browser Source after each post-bind loader update so a redirected stale CEF document cannot leave native audio without an authority client.

- Yield strict cached-opener batches by elapsed control-loop time, avoid re-yielding the library's already ordered startup batches, cap controller handoffs under sustained event-loop pressure, and reserve trusted source validation so an available fallback cannot turn into startup silence.

- Reuse the deterministic v16 startup batch to prove an opener's concrete successor before mapped-drive validation, preventing repeated selector waits from exhausting the audible-start deadline.

- Skip successor searches for automatic entrances that already fail the 16/32-bar rehearsal and cue-window safety floor, preserving bounded search time for later valid plans.

- Require fast cached AutoDJ startup openers to carry and prioritize a concrete safety-clean 16/32-bar successor instead of relying only on a synthetic future-exit probe.

- Replan AutoDJ candidates after awaited selector or analyzer work, reject expired cues instead of fading, and keep cold or outdated v15 analysis upgrades off the foreground path when their worst-case runtime would pass the last usable 16/32-bar cue.
- Submit a trusted opener's bounded priority upgrade from its real remaining cue runway instead of suppressing it with throttled background-analysis averages.
- Refresh live candidate diagnostics after final post-wait replanning so reported cue geometry and timestamps match the transition that is actually armed.
- Preserve reusable analyses from rejected startup pairings for a distinct fallback opener, fence them to the exact startup lifetime, and replan watchdog starts that arrive after their musical cue.
- Retain the completed native transition identity until its delayed quality event is forwarded exactly once, preventing finished mixes from disappearing from evaluation history.
- Refuse deadline AutoDJ beatmixes with any rehearsal warning or missing v16 cue-window proof, prefer a lower issue-free chainable plan, and revalidate that safety again when OBS commits the transition.
- Refresh the lightweight analysis cache when playback authority arrives, then prefer a strict cached v16 AutoDJ safety candidate before starting another live priority-analysis wave while retaining the bounded cold-search fallback.
- Retain completed priority analysis in AutoDJ's warm candidate pool and immediately retry the same outgoing deck, preserving still-valid 16/32-bar safety plans through rescue so late analyzer results can reserve a concrete successor before the cue.
- Keep explicit AutoDJ candidate exclusions through analyzed-library cooldown fallback, retain a safe unchainable 16/32-bar entrance across retries, and continue bounded successor lookup past duplicate draws until a concrete safe next deck is reserved.
- Continue the bounded future-successor search past cold cache entries so a safe analyzed 16/32-bar chain can arm before its cue instead of hard-advancing at track end.
- Allow the exact unconfirmed cached opener through the final startup ownership check while still rejecting stale settings, authority, request, generation, or replacement-track lifetimes.
- Search from each proposed AutoDJ deck's future tempo neighborhood and reserve its analyzed 16/32-bar successor before arming the current transition, preventing terminal decks from stalling at their cue or track end.
- Enforce the ten-second current-null AutoDJ load deadline through the indexed opener cache, reserve external-output cleanup time, and recheck exact startup ownership before emitting playback.
- Preserve long native AutoDJ track identities in OBS authority, deck, recovery, and guarded deployment checks instead of truncating valid Traktor IDs.
- Keep AutoDJ startup responsive by scanning cached opener metadata in yielding batches, rejecting unsafe rows in memory, and validating/materializing only the first musically eligible source before playback.
- Bind priority analysis to the validated physical audio file across mapped-drive and UNC aliases, while rejecting files replaced at the same path before a result can hydrate or play.
- Scan the complete reachable analyzed cache for a deterministic long AutoDJ opener, report per-gate rejection reasons, and keep trusted Traktor recovery openers transition-fenced until their v16 upgrade completes.
- Submit a trusted-grid opener's exact v16 upgrade as soon as playback is confirmed, even when an online request already owns the next handoff, and expose its lease, callback, identity, and application state.
- Keep the exact viewer request at the queue head when native output reset fails, wait for a fresh sole native epoch, and retry it before any later request can advance.
- Route large request tempo jumps through at most one 16/32-bar Tempo Flow bridge, keeping automatic legs within six percent and the exact request within twelve percent instead of slowing it drastically or using an eight-bar fade.
- Accept preserved external OBS requests during guarded native deployment only with exact identity, advancing playback, authority, queue-order, and zero-fault proof, allow newly appended requests without losing the preserved prefix, and keep local tracks strict to their native deck and sample clock.
- Re-arm guarded cached AutoDJ playback immediately after an external request ends, preserving the exact queued request while bounded source cleanup and slow finish listeners complete, without letting a late OBS source write blank a newer request.
- Prevent direct provider URLs from fuzzy-matching a same-title library track when their authoritative artist metadata conflicts.
- Fence cached AutoDJ startup to the exact playback authority and settings lifetime, ignore late intake work after shutdown, and reject cached analysis without exact source file facts.
- Restore the lightweight final0 startup cache before analyzer intake and index rebuilding, validate a reachable long opener through the library, and begin playback without waiting for watched-folder initialization.
- Start a reachable proven long analyzed opener immediately after the warm startup pass when no safe pair is ready, fail closed across genre/recent/source changes, preserve the viewer request's one-track priority without rewriting it, retain late analyzer results, and prepare the opener's 16/32-bar successor immediately after playback confirmation.
- Apply the same calibrated native output-presentation delay to the live waveform and beat pills, preventing both visuals from leading the heard audio without changing the analyzed beat grid.
- Coalesce restored analyzer callbacks until the priority intake is active, then skip cached unsafe startup pairs without spending the bounded cold A/B analyzer wave; only a job accepted by the analyzer scheduler consumes that wave, preventing AutoDJ from retrying silently with no first track.
- Backfill missing final0 analysis across the music library only when live CPU, GPU, memory, event-loop, and native sink headroom are safe, with truthful device, worker, progress, file, pause-reason, and ETA status in the AutoDJ dashboard.
- Let queue and transition analysis immediately reclaim a background analyzer worker, safely requeue the interrupted full-track pass, gate batched library-index refreshes on live headroom, and prevent the watched-folder scanner and collection backfill from analyzing the same file twice.
- Preempt background analysis for a bounded parallel startup pair when the warm v16 pool has no safe successor, and expose startup reservation/retry progress instead of leaving AutoDJ silently idle.
- Reserve and preserve a current-analysis 16/32-bar successor before automatic startup or EOF recovery, and skip terminal analyzed candidates within the same planning pass instead of hard-advancing through unplanned tracks.
- Fence delayed startup reservations and background analysis to the exact playback, request, and settings lifetime, keeping unsafe requests queued and draining the next deck's prefetch after a crossfade.
- Require a concrete analyzed successor whenever a candidate is proven to have no usable future exit, even when its nominal post-handoff duration exceeds three minutes.
- Start successor planning before external now-playing work, and reserve a proven analyzed 16/32-bar successor before admitting an automatic deck with less than three minutes of post-handoff runway.
- Make a short one-track request bridge reserve and revalidate the exact analyzed viewer request with the same cue-window, rehearsal, tempo, phase, and transition-shape plan used after handoff.
- Prevent native transition commits from blocking live audio by moving every Windows decoder process-tree teardown off the render/control mutex.
- Expose sanitized native restart diagnostics, retaining the failed probe, prior exit, child error, and authenticated epoch change after a supervised replacement.
- Fence stale transition callbacks on native transport loss, reconcile repeated epoch changes, preserve the exact audible deck position, rate, pause, and volume, adopt commits during recovery, and require fresh prepared readiness without skipping a healthy current track.

- Discard candidate searches that finish after their outgoing deck, preparation generation, or request head changes, preventing a stale transition from arming across playback handoffs.
- Arm a reusable analyzed safety track before starting cold foreground exploration, and recognize an exact Punch ownership landmark inside a 16/32-bar overlap so a late safe beatmix cannot be replaced by a fallback fade.
- Exclude an analyzed automatic candidate as soon as it proves to be a terminal fade, unsafe handoff, or unchainable beatmix below the retained safety floor, so scheduled retries broaden the search instead of selecting the same dead end until its cue expires.
- Preserve Traktor Auto-Gain through v16 analysis, stop recursive session-trim propagation, and reserve limiter headroom so normalized tracks no longer ratchet to the +12 dB ceiling across transitions.
- Retain every safety-proven 16/32-bar plan while broader successor search runs, then arm the best one before another analyzer wave can spend its cue, preventing a future-exit rejection from cascading into repeated end fades.
- Prove automatic fade successors with production v16 evidence, retain per-deck rejected analyses for later tracks, and restart late automatic recovery at the first analyzed downbeat to prevent deep-cue fade cascades.
- Keep a must-play 16/32-bar beatmix full-band when the outgoing track reaches a break before the incoming drop, preventing Punch isolation from opening a multi-bar bass gap; viewer priority can no longer bypass measured cue-window safety.
- Anchor beat pills and waveform downbeats directly to the analyzer's selected grid start, preventing raw beat phase from being applied twice and showing audible beat one as beat four.
- Measure absolute full-band and bass energy around every v16 mix cue and its outgoing pre-roll, then reshape the native Layered/Punch overlap or search another 16/32-bar cue before allowing an automatic fade fallback.
- Require current cue-window evidence before automatic native arming, preventing older or synthetic analysis points from bypassing level and bass continuity checks.
- Reject automatic 8/16/32-beat phrase-hierarchy mismatches such as `0/8/-8`, while retaining an explicit rejected-evidence path for must-play viewer requests.
- Budget priority analysis against the latest usable transition cue, re-plan against the live deck clock after analysis, and keep one already-analyzed successor armed while broader candidates are explored in the background, preventing completed analysis from selecting a phrase that already passed.
- Trim analyzer beat timestamps that fall just beyond the trusted file duration before native preparation, and report the native HTTP error code and diagnostic when a deck is rejected instead of collapsing it into a generic prepare failure.
- Render unavoidable native fallback fades as a full-band constant-power crossfade, without a synthetic Punch handoff, and rebase the envelope continuously to the decoded outgoing endpoint when file metadata runs long.
- Align the live waveform and its beat/downbeat guides to the native sink's audible sample clock and analyzed grid origin, while retaining the browser output-delay correction and snapping cleanly across native engine, stream, and deck replacements.
- Preserve absent loudness metadata instead of treating it as 0 LUFS, preventing native Auto-Gain from cutting metadata-cold tracks to the -18 dB floor and propagating that session anchor.
- Judge both native pre-roll and overlap level plus post-limiter bass on the same browser-equivalent one-second energy envelope, preventing a raw 20 ms boundary chunk from being misreported as an abrupt gain change, and retain fixed-tempo sample-clock phase evidence after real cue-start silence.
- Preserve native Punch frame timing, bass envelope, limiter, and sample-clock phase provenance through transition evaluation and learning records instead of dropping it at the TypeScript contract boundary.
- Keep the native promotion verifier's one OBS client as an array under Windows PowerShell 5.1, so a healthy sole authority passes the guarded deployment gate.
- Raise the native OBS PCM cushion to 960 ms, preventing CEF main-thread and concurrent analyzer stalls from starving the 960-frame packet ring during playback.
- Bridge an isolated native sink miss across one complete 128-frame AudioWorklet quantum for up to one 20 ms packet, report concealed gaps separately from zero-output underruns, and reserve the 80 ms re-prime watermark for sustained starvation, preventing a millisecond-scale miss from becoming a long playback pause.
- Retain the best analyzed beatmix across AutoDJ search retries and reject explicitly rhythm-unstable dual-bass collisions, preventing repeated cold selection from expiring into an unstructured end fade.
- Start analyzing the following AutoDJ transition as soon as the committed incoming deck confirms playback, preserving the full planning runway on short tracks instead of waiting for the prior crossfade tail.
- Let a new viewer or priority request replace an early prepared successor while the prior crossfade tail is still active, without cancelling the audible transition or losing request authority.
- Scope and de-duplicate the OBS playback bootstrap so native overlay startup cannot stop before Socket.IO registration on a repeated or cache-busted script evaluation.
- Activate each native release through a freshly named local HTML retry loader after port 3000 is healthy, retaining OBS startup recovery while moving the player to a top-level loopback page where CEF exposes AudioWorklet.
- Preserve the exact OBS native-audio startup error and browser build identity in live telemetry and deployment gates, so a failed sidecar handoff identifies its real CEF failure instead of only reporting WebAudio fallback.
- Wait for external FFmpeg probe pipes to close before parsing capabilities, preventing Chocolatey launchers from intermittently hiding valid Rubber Band filters at native startup.
- Prefer Chocolatey's real FFmpeg executable over its launcher shim for deterministic repeated native-audio starts.
- Match native playback gain to the browser's Traktor Auto-Gain and LUFS rules, and anchor incoming normalization to the audible outgoing deck without trusting browser-supplied loudness values.
- Hold linked limiter attenuation across bass-wave valleys before releasing smoothly, preventing low-frequency pumping while retaining zero-latency sample-peak protection.
- Report native deck position from the OBS sink's audible frame on an immutable source clock, keeping cue nudges, tempo automation, and rendered-ahead buffering from shifting beat telemetry.
- Use a measured low-modulation Rubber Band profile for key-locked tempo changes, retaining transient timing and stereo phase while reducing the metallic flutter of the initial native profile.
- Add the loopback Rust audio sidecar for local AutoDJ decoding, Rubber Band key-locked stretching, EQ, crossfades, limiting, and one finished 48 kHz PCM stream to the OBS Browser Source, with automatic browser fallback.
- Keep native beatmatching on one fitted sample-clock rate, expose its sink clock and underrun counters, preserve unavailable measurements as unknown, and complete Punch bass ownership during the final quarter-beat exactly on beat one with target-versus-completion frame proof.
- Calibrate each native Rubber Band rate against the active FFmpeg, pre-roll and trim its real-time stretcher at exact sample frames, and seek on the source timeline so tempo-matched transients stay aligned instead of shifting with the playback rate.
- Require an exact acknowledgement that the authoritative OBS output is silent before handing playback to an external YouTube or SoundCloud source.
- Package deterministic upstream license and notice text for every locked native runtime dependency.
- Keep the optional embedded desktop player as a silent, non-authoritative monitor while OBS owns native audio, preventing duplicate-output echo or comb filtering.
- Gate native-audio promotion on a sole advancing OBS sink, working Rubber Band tempo automation, and explicit sidecar health while draining its private port during upgrades and rollback.
- Drive overlay beat pills from the continuous analyzed BPM lattice when available, preventing extra kick transients from making the display jump ahead.
- Release stale post-restart online-analysis reservations immediately when that provider is no longer locally preparable, so a preserved viewer request cannot be bypassed by another crate track.
- Hold one stable browser playback rate after every audible launch, including small Tempo Flow returns, eliminating Chromium pitch-stretcher wobble from recurring rate writes.
- Keep searching the broad crate while one real analyzer wave still fits instead of committing a rehearsal-proven bass/level mismatch, retain completed transition scoring through the browser-tail watchdog boundary, and avoid double-trimming an already loudness-normalized incoming deck.
- Analyze and hydrate each track's independent eight-bar phrase origin, prefer pairs aligned at 8/16/32-beat phase, and retain exact beat-only/phrase evidence through live candidate selection.
- Complete Punch bass ownership on the chosen beat-one sample, with the low-EQ ramp entirely before the downbeat instead of lingering into beats two and three.
- Prevent post-launch hard seeks and unrelated-track acoustic nudges on fixed-tempo browser mixes, and hold large matched rates instead of audibly stair-stepping Chromium back to native tempo.
- Cap normal automatic and bridge-track tempo selection at six percent (or six BPM), reserving larger stretches for must-play viewer requests with at least a 32-bar path.
- Make large viewer-request tempo changes an explicit renderer-independent rate hold, while ordinary Tempo Flow returns use at least 32 bars.
- Select the following bridge from the deck's effective held tempo instead of its native tag BPM.
- Prefer tracks with a proven later exit without discarding every rehearsed current beatmix into an end fade when that future cue is not yet advertised.
- Let sub-four-minute Smooth tracks use a proven 60-second solo hold when their analyzed last-safe 16/32-bar outro would otherwise be missed, while retaining the 90-second target for normal tracks.
- Match each automatic analysis batch to the stream PC's two worker lanes so one wave ranks and arms before the outro instead of queueing a second fake-parallel wave.
- Tighten Punch bass ownership into the final quarter beat and keep loudness safety at an audible 82 percent, preventing the outgoing bass and overall mix from sagging before the incoming drop.
- Keep the browser deck at one stable launch rate during audible overlap, using live phase tracking as diagnostics instead of repeatedly resetting Chromium pitch stretch and making the music wobble.
- Refuse automatic decks whose real next-exit probe is a proven dead end, synthesize short-track exits from completed grids, and pre-analyze two following tracks while an earlier transition is armed.
- Count Smooth's required 90-second solo hold as the next deck's background-analysis runway, preventing valid later 16-bar exits from being rejected by a duplicate delay.
- Rescue narrowly bounded final0 tempo-review tracks with a proven stable EDM pulse lattice, using their trusted 110–220 BPM regularization reference for a conservative 16-bar mix instead of an end-of-track fade.
- Prove each fully analyzed automatic deck's advertised future exit through the real Smooth planner before selecting it, preventing a good mix from handing off into an immediate no-cue fade trap.
- Reserve a full background-analysis runway before selecting the next automatic deck, and apply stronger measured loudness-mismatch shaping to prevent bass and level spikes.
- Let completed analyzer passes strengthen older conservative Traktor confidence floors so viable AutoDJ pairs reach phrase selection instead of falling back early.

- Automatically tighten incoming level and bass isolation when rehearsal detects a collision-prone transition pair.
- Smooth selection now rejects an incoming entry that cannot still provide a later 16/32-bar exit after its configured solo hold, preventing short tracks from becoming end-of-track fade traps.
- final0 now compares its pulse tempo with onset and file-tag clocks against the complete track, repairing half-time/full-time EDM grids when a slightly wrong model tempo would otherwise drift out of phase.
- Recover automatically when the playback browser never confirms that a selected request or AutoDJ track started, instead of leaving the mix silent indefinitely.

- Smooth AutoDJ now permits a tightly bounded final0 review grid for 16-bar profiled transitions and can hold a stable, fully arranged outgoing beat phrase instead of searching past it because it contains vocals or fills.
- Startup now waits until the background analyzer is callable before beginning the first AutoDJ deck, lets priority deck analysis enter the worker pool before the all-watched backlog, and retains the production intake's live analysis-priority callback instead of silently dropping it.
- Smooth fallback ranking now preserves an actual 16/32-bar runway into the incoming drop instead of replacing it with a cleaner but structurally wrong drop-on-drop start, and live phase lock can reconcile each deck's audible kick onsets against its own analyzed grid beyond the old 50 ms cross-track limit.
- Bass handoff curves now cross low-shelf gain in the linear domain to avoid the previous mid-transition bass hole, automatic selection searches past measured bass/loudness mismatches, and the master limiter catches short overlap peaks sooner.
- Automatic preparation now keeps one analyzed safety candidate beside three fresh full-collection draws and waits up to 75 seconds when runway permits, preventing repeated cold-analysis batches from expiring into an end-of-track fade.
- final0 result application now yields between completed tracks, and full-collection candidate lanes reuse the genre index instead of rebuilding tens of thousands of temporary selection objects, keeping the app responsive while analysis runs.
- AutoDJ now draws every automatic candidate lane from the full eligible collection, preventing warm analyzed tracks from repeatedly collapsing large crates into a small recurring pool.
- Background AutoDJ and watched-folder analysis no longer rebuild the full request-match index for every finished track; analyzed Traktor masters retain their existing identity while genuinely new files use a small supplemental index.
- Large watched-folder rescans now yield between catalog batches and skip unchanged reconciliation, preventing periodic multi-second control/UI stalls while still honoring the configured recheck interval.

- Expanded automatic selection beyond the small warm-analysis pool by reserving two full-collection candidates per batch, pre-analyzing a fresh follow-up track during safe idle runway, and blocking the last 25 song families.
- Preserved live AutoDJ playback history during app promotion so test builds no longer make recently played tracks eligible again.
- Restored metadata-only local history entries after restart so the 25-track cooldown is not silently filtered from runtime state.
- Removed duplicate legacy structure and fade passes from full-collection AutoDJ candidates before their final0 analysis, reducing time spent waiting for the incoming track.
- Waited up to 45 seconds for fresh full-collection final0 candidates when ample mix runway remains, allowing them to compete with already-warm tracks instead of always being rejected as unfinished.
- Added a deployment-interrupted automatic deck to recent history without replaying it, preventing repeated test promotions from recycling the track that was just audible.
- Bounded live acoustic beat nudges to 50 ms so a false cross-track correlation cannot pull an accurate analyzed beat grid a quarter-beat out of sync.

- AutoDJ now keeps rehearsals with simultaneous bass-collision, bass-handoff, and loudness warnings provisional while it searches the wider collection for a cleaner pairing.
- AutoDJ candidate ranking now lets measured beat, phase, bass, and loudness quality outweigh a weak analyzer role label more readily.
- Smooth AutoDJ no longer lets an `intro` label override a substantially cleaner exact-drop groove elsewhere in the incoming track.
- Smooth AutoDJ now rejects an outgoing phrase when a loud first half hides a breakdown or fade in the second half, preventing bass holes before the incoming drop.
- AutoDJ now commits the best provisional 16-bar beatmix with two minutes of cue runway and bounds each search to eight candidates, so analyzer retries cannot consume a valid cue and fall back to a late fade.

- Every automatic preparation batch now reserves one parallel analyzer lane for a random compatible track from the full eligible Traktor collection, so the warm analyzed cache cannot collapse a massive library into the same small recurring candidate pool.

- Automatic candidate ranking now treats intro/body labels as a bounded preference and lets materially cleaner beat, bass, vocal, phase, and loudness rehearsal evidence choose the incoming track, avoiding collision-prone overlaps when a better exact-drop runway is already prepared.

- Smooth AutoDJ now compares the rhythmic quality of complete 32-bar and 16-bar drop runways, so a weak or melodic first half no longer displaces a cleaner 16-bar beat-section entry into the same drop.
- Exact-drop blends now switch bass on the drop and release the outgoing deck over one full bar, avoiding the abrupt level and bass hole caused by squeezing that release into one beat.
- Fixed-tempo mixes now keep one fitted playback rate through the overlap, using phase seeks instead of noisy marker-driven rate swings that made Chromium's pitch-preserving stretcher audibly step.

- Smooth AutoDJ now prefers complete 16/32-bar rhythmic runways that cross compatible analyzed sections and land on a drop, instead of rescuing with an intro that ends on a breakdown.
- Live beat correction can apply one early jog from consistent medium-confidence acoustic evidence, and tempo-flow returns now use a lower-churn eased control curve to avoid audible stepped slowdowns.
- Fixed-tempo EDM transitions now hold their fitted deck rate on the render clock instead of chasing noisy raw beat markers, and drop-aligned Smooth blends retain the outgoing bass and level until the actual payoff downbeat.

- Smooth AutoDJ now keeps 32- and 16-bar routes to the same final release, prefers an opening exact-drop runway over later body/groove cues, and recognizes bass-led four-on-the-floor phrases without mistaking their low HPSS percussion ratio for a breakdown.
- Accepted fixed-tempo final0 plans now clear unattended preparation early instead of being searched again until the last-second fallback window.
- Smooth preparation now keeps deep mid-track drop runways as bounded fallbacks while using available lead time to search for an opening or early-track entry.

- Smooth AutoDJ now prioritizes measured 16-bar beat-led runways that land exactly on a drop over generic groove overlaps, requires strong kick agreement before a live phase seek, and ignores sub-audible telemetry stalls.
- AutoDJ now carries section energy, percussion, bass, vocal, and fill measurements onto analyzer mix-point rows before ranking them, preventing good post-intro and pre-drop beat beds from being treated as unknown cues.
- Automatic selection now keeps inspecting warm candidates until a plan clears the complete unattended reliability floor, rather than stopping at the first merely usable groove overlap.
- Final0 tracks with ambiguous bar one but a stable regularized four-four lattice can now use a conservative 16-bar structural mix instead of forcing every candidate to fade.

- Accumulate measured acoustic residuals instead of converging halfway to the audible beat, and apply one bounded early-deck seek when two windows agree on a 100-160 ms analyzer offset.
- Hold an acoustically confirmed one-time deck correction as the transition's new grid anchor, preventing the mathematical phase loop from dragging a successfully aligned deck back out of sync.
- Derive live acoustic phase correction from each deck's kick/bass onset envelope instead of ambiguous full-band vocals and synths, with RMS retained only as a telemetry fallback.
- Sample each deck before transition trim and EQ, so the bass handoff curve cannot distort the kick envelope used to align the tracks.
- Preserve measured energy, percussion, vocal, fill, and beat-only evidence on first-beat-entry cues, so the selector can distinguish an actual post-intro groove from an unmeasured middle-of-track guess.
- Keep low-tempo-map or poor-layering beatmixes only as timed provisional fallbacks while parallel batches search for a stable beat-bed pair, then commit the fallback 30 seconds before its cue rather than analyzing until the track ends.
- Keep the best rehearsed, phase-safe 16/32-bar transition armed as the unattended floor, so searching for a nicer layering phrase cannot consume the track and collapse into a last-second sweep.
- Prioritize analyzed 16/32-bar entries that land exactly on an incoming drop over generic intro phrase endpoints, preventing Smooth mixes from layering a phrase too early.
- Keep beat-led outgoing phrases eligible when they contain normal EDM fills, avoiding false `insufficient-transition-room` fades while preserving strict incoming-layer checks.
- Accept exact phrase-locked beat layers when one deck supplies the strong structural landmark, instead of discarding them for a marginal preflight structure score.
- Make Smooth `Last safe` choose the latest complete cue inside the final viable section before pair-score tie-breaking, so louder earlier phrases do not cut tracks short.

- Let stable final0 tracks whose only warning is ambiguous beat one use a phase-locked 16-bar transition instead of rejecting every candidate and fading at the end.
- Prefer a measured drop, body, or groove entry over an intro that hands off into a breakdown, while leaving bass and loudness mismatches to the configured transition shaping.

- Smooth AutoDJ now rejects overlaps that hand off into an incoming breakdown, can use a measured full-strength beat/drop section when no 16-bar intro reaches a payoff, and keeps searching while enough preparation runway remains.
- The WebAudio mixer now samples the outgoing deck's actual live Tempo Flow rate at the transition downbeat, recalculates incoming beatmatch and phrase duration, and never forces the outgoing deck back to a stale prepared speed.

- Smooth AutoDJ now requires measured clean beat beds on both sides of a layered transition, carries full-window evidence into synthesized last-safe outro cues, and ranks candidate bass/vocal compatibility before arming the mix.
- Live acoustic beat correction now retains stable audible onset alignment through briefly ambiguous musical windows instead of rapidly falling back to a visibly correct but audibly offset grid.
- Transition rehearsal now scores bass strength continuity at the ownership switch, and automatic selection keeps searching instead of handing a high-energy outro to a thin non-drop section.

- Revalidated prefetched tracks against the new outgoing deck's 12% tempo neighborhood and prohibited the final automatic rank from arming an engine-unsafe stretch.
- Made Smooth compare every viable intro, groove, and buildup by its measured full-window beat bed, preferring a sustained low-vocal underlay over a merely valid riser into a drop.
- Carried synthesized buildup energy, percussion, vocal, and fill evidence into cross-track ranking so semantic cue labels can no longer hide a poor layering section.
- Added a one-beat post-drop release to exact 16/32-bar drop landings, so the outgoing groove and bass hold through the complete incoming phrase instead of fading during its final pre-drop bar.
- Made Smooth rank a sustained percussive groove landing on a drop above a lower-confidence buildup phrase, keeping the audible overlap on two compatible beat beds.
- Made Smooth continue searching past buildup-only pairings for a clean 16/32-bar beat-bed entry when preparation time permits.
- Re-ranked every searched candidate after expansion instead of accidentally arming the last inspected fallback, while keeping the parallel analysis batch bounded to avoid UI stalls.
- Constrained automatic crate picks to the WebAudio engine's safe 12% tempo window instead of accepting a badly stretched cached candidate.
- Let speculative AutoDJ candidates fall back to random close-BPM Traktor tracks when the analyzed cache has no engine-safe match, so the selector can analyze viable alternatives instead of exhausting the same incompatible cache.
- Kept cold-library fallback on the bounded random picker instead of synchronously ranking all 65k Traktor tracks on the playback server thread.
- Made automatic crate selection search past otherwise valid beatmixes that require more than 12% Chromium tempo stretch, while keeping viewer-request priority and its one-bridge rule.
- Made automatic Smooth selection prefer 16/32-bar drop landings and clean percussive intros on real phrase boundaries over inferred mid-intro entry points.
- Prevented late eight-bar analyzer cues from hiding an available 16/32-bar Smooth phrase, keeping EDM transitions at the configured sixteen-bar minimum.
- Kept final0 beat grids authoritative when cross-track onset correlation is weak or implies a large false nudge, and now releases stale acoustic corrections instead of carrying them through the handoff.
- Held the outgoing deck at full level until an explicit buildup-to-drop handoff, preventing the incoming pre-drop bar from creating an early volume and bass hole.
- Centered Punch bass swaps tightly on the chosen ownership downbeat and made automatic transition grading use a one-second energy envelope instead of mistaking individual kick hits for level failures.
- Held outgoing bass through an incoming buildup until its drop, then performed the configured handoff and release, and kept a 90% layered deck from ducking the complete mix.
- Let Smooth synthesize an exact 16-bar entry across adjacent rhythmic intro sections when that phrase lands on the detected drop, instead of selecting an earlier phrase that lands in another quiet intro section.
- Let Smooth choose a materially stronger early second-entry beat phrase over a merely valid opening by scoring audible percussion, energy, vocal/fill safety, and 16/32-bar structural landings.
- Kept Smooth beatmixing when an analyzed final rhythmic section is labeled body or handoff instead of outro by searching backward for the latest rehearsed 32/16-bar profiled bridge.
- Added bounded live acoustic beat nudging so audible deck onsets can correct a locally offset analyzer grid during a transition without hard seeks.
- Rejected 16/32-bar layering windows whose average hides a quiet or non-percussive subsection, keeping the full overlap on an audible beat bed.
- Anchored incoming LUFS normalization to the level already audible from a metadata-cold first deck, preventing a large volume drop at the first handoff after startup.

- Ranked stable accepted tempo maps above review-only variable-tempo candidates when both have rehearsed beatmix plans, avoiding acoustically drifting mixes chosen for loudness alone.
- Applied authoritative outgoing rate and beat-grid selection in the actual compiled browser source, preventing packaging from restoring stale deck timing.
- Kept the next beat grid locked to the deck's post-Tempo-Flow rate while the previous return ramp is still running, preventing a stale matched rate from accumulating multi-second phase drift.
- Sent the exact outgoing deck analysis, beat grid, and settled playback rate with every prepared transition, preventing the browser mixer from timing a musically valid overlap against stale deck metadata.
- Smooth AutoDJ now rejects near-silent rhythm-shaped cues and searches every audible opening or second entry for a 16/32-bar phrase that lands on the drop.
- Smooth Last-safe now ignores zero-energy spectral residue at the tail, preserving the earlier intact 16/32-bar outro instead of rejecting every candidate for insufficient room.
- Parallel AutoDJ candidate selection now ranks rehearsal cleanliness, audible cue energy, structure, beat-layer confidence, phase safety, and loudness instead of taking the first equally confident result.
- Smooth AutoDJ now requires a measured percussion-led incoming phrase, so bass-heavy melodic bodies no longer displace a cleaner second beat entry for viewer requests.
- Smooth AutoDJ now enforces 16-bar minimum overlaps and waits for the outgoing deck's final0 analysis instead of arming a timed-out fallback fade.

- Kept a viewer request on the best analyzed phrase/downbeat blend after its single allowed bridge instead of demoting a conservative rehearsal result to an end-of-track fade.
- Added an analyzed 16-bar minimum emergency phrase bridge for must-play requests when strict landmark and phrase-length labels reject an otherwise beat-led pair.
- Tempo-matched owned requests from their first available mix opportunity, then returned them toward native tempo after the handoff instead of waiting until they had already consumed a bridge track.
- Prepared the following transition during Tempo Flow against the deck's settled rate, and accepted final0's regularized beat-grid confidence when its semantic downbeat label remained conservative.
- Removed audible quarter-second tempo stair-steps by driving Tempo Flow at render cadence, and kept one-track request bridges at the matched set tempo instead of ramping them away immediately before the request.
- Rejected vocal, fill-heavy, or energy-only body cues from layered Smooth entries and searched multiple later analyzed 16/32-bar rhythmic sections when the opening was not clean enough.
- Kept promotion-restored requests queued while their final0 payload rehydrates instead of immediately arming an analysis-free startup fade.

- Kept an automatic bridge mix armed while the first viewer request is reserved for local analysis, and re-armed viewer handoff timers when requests arrive before the incoming AutoDJ deck finishes playback confirmation.
- Made every lost prepared transition schedule a replacement and continued directly onto the incoming deck when its playback confirmation races the outgoing preparation promise, preventing unattended full-track playouts with a stranded request queue.
- Limited owned requests to one bridge track, then forced their analyzed beat phrase into the next transition with expanded tempo-flow matching and a longer return to native BPM instead of allowing another random track or plain fade.
- Preserved viewer ownership and source identity when final0 refreshes a queued local track, keeping the playing request recognizable across announcements and safe app promotion.
- Counted the neutral opener chosen after online playback as the owned request's single allowed bridge, so the following planner must mix that request rather than insert another bridge.
- Retried a must-play owned request after transient incoming-deck buffering failures instead of excluding it and falling back to random candidates.

- Rehearsing or mixing an already-buffered AutoDJ transition now reuses its ready incoming deck instead of reloading the file and losing the remaining lead time.

- Rehydrated the playing AutoDJ deck from completed final0 library analysis after a priority-analysis wait times out, preventing stale Traktor-only metadata from rejecting every later candidate as `insufficient-analysis-confidence`.
- Let a cold playing deck use one bounded final0 wait early in the track while keeping speculative incoming analysis non-blocking, avoiding repeated full candidate searches before the outgoing structure exists.
- Let transition preflight recognize a measured percussion or kick-bass bed even when the analyzer reports low repetition stability, preventing every incoming track from being rejected against the same usable outgoing phrase.

- Smooth AutoDJ now treats an analyzed four/eight/sixteen-bar rendered fade tail as the end of the last intact beat phrase, preventing repeated `outgoing-room` rejection and last-second sweep fallbacks.
- Smooth AutoDJ now uses the last analyzed beat-led handoff into a terminal quiet section when a track has no rhythmic section labeled as an outro.

- Restored current final0 analysis now replaces stale older analyzer metadata before AutoDJ ranks tempo-compatible transition candidates.
- Cached analysis hydration now rebuilds the large collection indexes once, avoiding a long event-loop freeze after startup.
- Transition rehearsal no longer double-penalizes moderate vocal presence when an incoming phrase has a measured percussion bed.

- AutoDJ now restores validated priority final0 results from SQLite onto their Traktor tracks at startup, so analyzed tracks remain immediately selectable after a restart instead of being rescanned.
- AutoDJ now validates its bounded priority cache in parallel and sends cold transition candidates straight to final0 instead of blocking selection behind the older full-file structure analyzers.
- AutoDJ rehearsal now preserves final0 beat-grid confidence when no extra phase-correction window is needed, preventing clean analyzed grids from being rejected as zero-confidence transitions.
- AutoDJ now restores its priority SQLite cache before analyzer/model startup and chooses the first deck from final0 evidence, avoiding two cold startup analyses that could stall the stream PC.
- Smooth now treats a beat-led final drop or groove that lands on an analyzed outro/fade as a valid last-safe exit, even when the analyzer grid ends before the audio tail.
- Analyzer startup now verifies Python, CUDA, and dependencies without eagerly loading final0; the large model loads only when a cold track actually needs analysis.
- Priority cache restoration now avoids blocking startup on every network file while retaining exact size/mtime validation when a cached track is actually selected.
- AutoDJ now keeps every speculative transition candidate biased toward cached final0 evidence, clears tempo-stale prepared candidates whenever the outgoing deck changes, and starts smooth recovery sessions from analyzed tracks with enough runtime to prepare a proper phrase blend.
- Kept final0 priority analysis running in the background without holding AutoDJ preparation open for 45 seconds, selected the startup deck before generic folder workers can claim analyzer capacity, limited speculative alternatives to cached final0 evidence after one bounded cold fallback, tried up to twelve distinct pairings, and exposed each rejected rehearsal in live diagnostics so completed analysis can produce a safe armed deck instead of a last-seconds fallback.
- Ranked a broad analyzed track reservoir by the actual outgoing-to-incoming plan, excluded fade-tail starts before Smooth Last-safe grouping, accepted strong exact phrase profiles when coarse section edges drift by a bar, and retained pair-gate diagnostics on every plan.
- Anchored live AutoDJ phase correction to the Web Audio render clock, smoothing media-time jitter and recording residual, re-anchor, and fallback telemetry for each transition.
- Accelerated final0 analysis by overlapping GPU and loudness scans, removing the duplicate Python loudness decode, retaining measured precision and runtime, and keeping half precision opt-in when hardware benchmarks show a benefit.
- Kept analyzer cache identities honest so small0 results remain identifiable and selected tracks receive a real final0 pass instead of being relabeled as the larger model.
- Prioritized already analyzed AutoDJ candidates before cold library scans, kept speculative probes out of recent-track cooldowns, chose the safest available fallback, and reserved an earlier phrase-length Smooth rescue instead of a last-seconds sweep.
- Prepared up to four AutoDJ candidates in parallel with a bounded 45-second wait, retained safe analyzed runners-up for the following mix, and retried tracks whose final analysis was still finishing instead of letting one cold candidate delay the incoming deck until the outro.
- Rebuilt steady-tempo beat-grid analysis around a full-track consensus lattice that repairs missed and doubled model pulses without flattening corroborated tempo changes, and lets a verified Traktor beat-one prior raise the confidence gate it resolves.
- Stopped Smooth AutoDJ from arming low-confidence automatic sweep fades while safer tracks and planning time remain, retrying analyzed candidates and reserving emergency fades for the final rescue window.
- Kept occasional uncertain final0 beat grids from pulling otherwise tempo-matched decks off phase, using the stable linear clock for low-confidence or unstable tracks and validating trusted grids across the full 32-bar blend.
- Kept Smooth AutoDJ out of quick fades by accepting generic phrase endpoints only when they match real analyzed section boundaries, then trying the next early beat-led 16- or 8-bar entry before fading.
- Reserved a three-minute analysis quiet window around prepared AutoDJ transitions and matched persistent final0 processes to the configured worker count, preventing GPU-heavy collection backfill from stalling OBS during a blend.
- Added a reactive deck-shaping mix envelope that previews incoming and outgoing level, bass ownership, entry EQ, hold, and the engine's effective release point while controls move.
- Planned transitions from the live post-analysis preload horizon and tried another automatic pairing when phrase room is incompatible, preferring later clean analyzed cues over avoidable `insufficient-transition-room` recovery fades.
- Used a plain ASCII dash between artist and title in Twitch song messages while preserving the app and overlay typography.
- Downloaded Suno viewer requests into a managed temporary cache for final0 analysis and phrase-aligned AutoDJ mixing, retaining reusable analysis metadata after unreferenced audio is removed and leaving other providers unchanged.
- Stabilized the AutoDJ overlay beat marker across compact beat-grid window updates and delayed playback telemetry, preserving its eight-beat phase while smoothly slewing small clock corrections instead of jumping backward.
- Added automatic live transition review using rendered beat phase, phrase evidence, level and bass continuity, limiter activity, and buffering; only high-confidence results can conservatively improve future safe-plan ranking, with scores visible in Transition Lab.
- Preserved final0 analysis evidence for viewer requests across restarts and prevented a repeatedly late owned request from starving behind more than one automatic bridge track.
- Rebuilt AutoDJ analysis around independent tempo and downbeat hypotheses, variable-tempo maps, confidence and rejection reasons instead of committing silently to one beat grid.
- Added a transition preflight that rehearses the exact outgoing and incoming phrase windows, rejects unsafe automatic pairings, and tries another track before falling back to a conservative fade.
- Added idle collection-wide analysis on the spare worker, yielding to live transitions and viewer requests while keeping the complete Traktor library ready ahead of selection.
- Let Transition Lab corrections persist beat-one shifts and preferred entry or exit bars, and applied conservatively learned mix preferences only after enough ratings without bypassing safety gates.
- Added a labeled analysis benchmark for tempo, beat-one, and phrase-boundary accuracy, plus versioned AutoDJ v2 analysis evidence in the SQLite cache and status API.
- Made stream-PC promotion wait for the exact portable-app file lock after stopping its task, preventing a detached Electron launcher from blocking an otherwise safe update.
- Prevented alternate editions from repeating back-to-back when one file uses an `aka` artist credit and the other uses its shorter alias.

- Used idle analyzer capacity to pre-analyze the likely track after an armed transition, prioritizing queued owned requests and otherwise using the current genre, tempo, history, and mix-style filters without reserving the speculative track or changing selection order.
- Corrected ambiguous one-beat bar-grid offsets by using a tempo-compatible Traktor grid marker only when final0's beat-one phase confidence is weak, realigning downbeats, sections, and mix points together while preserving confident analyzer results.
- Made Smooth exit timing and entry position strict: the selected outgoing section is no longer abandoned for a higher-scoring middle cue, clean openings outrank internal drop routes, and an unsafe final beatmix fades at the chosen ending instead of moving earlier.
- Profiled every analyzed 8-, 16-, and 32-bar cue independently, so Smooth mixing can reject a melodic mid-break entry and prefer the stripped beat-only phrase immediately before its drop.
- Corrected steady-but-offbeat house transitions by searching beyond half a beat for the low-frequency kick phase and placing the muted incoming deck within 20 ms of the shared analyzed phase before its transition automation begins.
- Canonicalized AutoDJ tracks to a 110 BPM minimum interpretation, turning half-time detections such as 94 BPM into a true 188 BPM beat grid before beat-one, bar, phrase, and transition analysis.
- Required Smooth transitions to align both decks on analyzed arrangement landmarks, priority-analyzed the playing and incoming tracks in parallel, and rejected Traktor-only tail guesses instead of allowing a one-sided 16-bar phrase offset.
- Required Smooth intro/outro layering to use beat-led sections on both decks, rejecting quiet pre-drop breakdowns even when they form an exact 16-bar route to a drop and preferring a proven rhythmic opening instead.
- Kept normalized AutoDJ transitions at approximately single-track loudness with shared constant-energy overlap trim, while retaining per-track LUFS correction and limiter protection for unusually loud masters.
- Matched official YouTube uploads titled `Song - Artist ft Guest` to owned artist-first DJ editions when the channel confirms the artist credit, including S3RL ft Sara's Dopamine.
- Made Smooth Last safe count backward from the detected fade tail or final intact downbeat, prefer exact 32- or 16-bar entries that land on the incoming drop, and retain a beatmatched add-hold-bass-switch-release blend when analysis confidence is too weak for a full plan.
- Reserved viewer requests as soon as a matching watched-folder file appears and priority-analyzed those files before ordinary backlog work, preventing the normal queue from starting YouTube while a local AutoDJ version is still being prepared.
- Prevented an empty startup authority update from treating two absent AutoDJ transitions as the same transition and crashing while reading its ID.
- Rechecked normal viewer requests after every watched-folder scan, so a local master that becomes reachable after its one-time analysis callback is still promoted into AutoDJ without changing request order.
- Added live AutoDJ phase locking that follows consistent analyzed beat grids through variable beat intervals, rejects windows with missing or doubled detections, applies gentle pitch-preserving playback-rate nudges during the overlap, and reserves audible seeks for large startup errors.
- Filled the AutoDJ overlay's active beat pill with a bright cyan or warm downbeat color instead of leaving a dark center surrounded only by glow.
- Tuned the AutoDJ waveform to scroll seven eighths of a musical beat behind the scheduling clock, moving it slightly forward to better match the audible OBS output while retaining stable, tempo-scaled synchronization.
- Made the AutoDJ overlay paint each audible beat atomically: passed pills remain as a subdued trail, while only the current pill receives the bright beat/downbeat accent without delayed animation or overlapping color transitions.
- Kept the AutoDJ overlay's beat pills on a compact analyzed beat/downbeat timing window instead of silently falling back to a potentially one-beat-late Traktor grid marker.
- Restored cumulative filling for the AutoDJ overlay's eight beat-position pills, keeping every passed position lit until the next eight-beat cycle begins.
- Made Beat This `final0` the default automatic-analysis model, retaining unchanged `small0` entries under their original identity while new and priority-selected tracks receive the stronger model.
- Reorganized the AutoDJ control panel around the live two-deck signal path, keeping everyday mix controls visible while folding transition tuning, library wiring, analyzer internals, and OBS reference links into focused drawers.
- Rechecked the complete viewer-request queue after watched-folder scans, reserving every newly owned match for AutoDJ while retaining online-only blockers so request order survives playback and restarts.
- Prevented startup playback-client status updates from crashing the desktop app when reported status and a cleared AutoDJ transition race during authority selection.

- Matched bare viewer requests to owned extended, original, club, radio, album, single, or remastered editions despite normal duration differences, while keeping remixes, live, acoustic, and other materially different recordings separate.
- Kept the AutoDJ overlay waveform scrolling continuously with age-corrected live deck playback, aligned armed incoming cues on the same moving timeline, and widened the view to sixteen bars for clearer phrase context.
- Added a safe deployment mode that snapshots viewer requests, restarts an interrupted request from the beginning in its correct queue, and verifies request identities, order, and counts after promotion.
- Made the AutoDJ overlay's beat bar a one-segment eight-beat chase driven by age-corrected authority-deck telemetry, with monotonic refresh smoothing and duplicate-beat filtering to prevent late pulses and jumps.
- Added a two-deck phase-lock waveform to the AutoDJ OBS overlay, showing outgoing and incoming audio around their shared mix point with beat and downbeat markers; compact file-fingerprinted waveform data is generated once and cached across restarts.
- Made the AutoDJ overlay's eight-position beat display visibly fill every step, reset after beat eight, accent both 4/4 downbeats, and anchor the chase to analyzed downbeats instead of the first detected pulse.
- Reworked 4/4 beat-one detection to decode all four bar phases from Beat This's continuous downbeat evidence across multiple track windows, rejecting inconsistent beat-2/3/4 guesses instead of trusting Traktor or thresholded events.
- Increased the AutoDJ OBS overlay's titles, labels, metadata, countdown, transition details, and request queue text for better readability after stream compression.
- Kept owned song requests tempo-matched during safe-fade transitions; Match and Fixed hold the adjusted rate, while Tempo Flow returns from the matched blend rate to the request's native tempo over the configured bars.

- AutoDJ now priority-analyzes an unprocessed selected next track when the outgoing track leaves a safe preparation window, re-plans with the corrected beat grid and structure, and reuses the fingerprinted SQLite result on later selections; imminent mixes keep their already-prepared metadata.

- Prevented the Electron startup error dialog when a playback socket disconnects while its active AutoDJ transition is being cleared.

- Added a saved analysis-scope switch that can run the full cached AutoDJ analyzer over existing Traktor tracks in watched folders, replacing unreliable Traktor beat grids while preserving Traktor identity, genres, key, cues, and other library metadata without creating duplicates.

- Added an experimental saved AutoDJ switch that skips non-rhythmic or vocal openings and enters at the earliest safe analyzed 8+ bar beat section.

- Kept the five newest completed song families as hard AutoDJ exclusions, preventing a requested local track from being selected again from the crate after only one or a few intervening tracks.

- Added live, persistent Smooth exit targets for the first clean outro, one or two analyzed sections later, or the last safe phrase; Hold +1 is now the default and safety checks still run before the timing preference.

- Made the AutoDJ OBS overlay's eight tempo markers advance with the analyzed track beat grid, with a stronger beat-one accent instead of repeatedly blinking only the first marker.

- Keep an imminent prepared AutoDJ track in place when an owned song request arrives too late to preload safely, and reserve that request for the following mix instead.

- Keep tracks in Smooth and Adaptive AutoDJ sets for a meaningful solo section after each handoff before another automatic transition may begin; manual skip still takes the next safe phrase.

- Put alternate mixes, edits, remixes, and remasters into one recent-song cooldown across ranked and random AutoDJ selection, relaxing the oldest history only when no fresh eligible family is reachable.
- Prevented hyphenated digital re-master copies from bypassing AutoDJ's recent-song family cooldown.

- Added autosaving controls for incoming beat-layer volume, bass cut, mid/high EQ, outgoing hold level, and release position; armed transitions keep their original shape while later mixes use the new settings.
- Added live-configurable one-to-three-lane track analysis, defaulting to two workers, with centralized SQLite commits, transition-time throttling, multi-file progress, and automatic single-worker CUDA memory fallback.
- Added automatic kick/onset beat-grid refinement with persistent phase, bar-phase, drift, confidence, and cue-local alignment data for tighter AutoDJ transitions.
- Added a Transition Lab phase control in 5 ms steps; saved corrections are learned per incoming track and cue, then applied to later live mixes without changing the track BPM.
- Added an isolated Transition Lab for auditioning AutoDJ overlaps, rating phrasing, timing, beatmatch, bass, energy, vocals, and volume, and exporting a privacy-safe Codex improvement brief without changing the live set.
- Made clean intro/outro and post-break groove transitions start at an immediate 80% layer on beat one, without a phrase-length-dependent fade, while keeping the incoming bass cut until the chosen gradual or punch handoff; the Transition Lab records feedback about that house style explicitly.
- Fixed Windows analyzer requests for music filenames containing Unicode characters while preserving doubled spaces.
- Rebuilt EDM entry and exit planning around full-track inferred phrase phase and shared structural landmarks, with multi-feature novelty analysis, pairwise overlap scoring, pre-boundary handoffs, vocal-clash avoidance, and an explicit late bass and volume ownership switch.
- Made the normal OBS overlay show the prepared AutoDJ track and queued owned requests in its Up next list, with playback-order priority and duplicate removal.
- Made AutoDJ Skip choose the first nearby analyzed outro, breakdown, or energy-downshift exit, shorten the overlap to available phrase room, and use a future phrase or bounded fade as its no-seek fallback.
- Added post-intro groove detection for low-bass beat passages before an energy rise, letting Adaptive prefer those short clean entries and ranking richly analyzed watched-folder copies above generic Traktor duplicates in search.
- Prevented intermittent full track playouts by preferring the OBS client with active mixer telemetry, retrying missing plans before the ending, and recovering when browser playback or crossfade-complete events are missed.
- Kept owned `!sr` tracks reserved for a full style-planned AutoDJ transition after startup or a late arrival, using a bridge track instead of an emergency request fade, and blocked deployments from restarting while viewer requests are waiting to mix.
- Smoothed Tempo Flow playback by reducing pitch-preserving rate reconfiguration frequency and ignoring inaudibly small rate changes that could glitch Chromium audio.
- Made expired or revoked Twitch bot logins show an explicit HornBots reconnection prompt instead of failing silently and dropping track announcements.
- Prevented temporary test and diagnostic runtimes from inheriting the repository's real Twitch credentials and responding to live chat.
- Fixed settings being lost across desktop restarts or promotions by flushing pending autosaves before shutdown, serializing concurrent saves, writing recoverable atomic settings files, and keeping the unified app's settings authoritative during deployment.
- Added a separate, visual-only AutoDJ performance overlay for OBS with beat-synced artwork, effective BPM, current and next tracks, transition countdown, mix strategy, and queued viewer requests.
- Matched watched-folder remixes against `!sr` uploads even when the upload credits the original artist but local metadata credits the remixer, and persisted owned AutoDJ requests across app restarts.
- Kept both AutoDJ decks near 80% through the central transition overlap so mixes retain their perceived volume instead of dipping around the handoff.
- Fixed missing or failed local track covers leaving a broken image in OBS; the player now keeps the provider badge visible until artwork has loaded successfully.
- Made live AutoDJ style, Chaotic pool, bass curve, genre, tempo, and key changes save without unrelated Twitch reconnects, preserve any active or prepared mix, and take effect on the next unprepared transition.
- Added a persistent multi-select Chaotic transition pool with an explicit All four option, so any combination of intro, breakdown, buildup, and drop-slam mixing can rotate live.
- Expanded Chaotic into a phrase-aware EDM rotation with 16/32/64-bar intro blends, breakdown underlays, synchronized 8/16-bar buildup swaps, and beat-one drop slams with strategy-specific gain and bass automation.
- Eliminated multi-second AutoDJ-tab freezes by caching collection-wide status and genre summaries instead of rescanning the full Traktor library every two seconds.
- Rechecked queued online requests whenever watched-folder tracks finish analysis, moving newly owned matches into AutoDJ without letting later requests jump the queue.
- Resolved artist and track identity for every normal request, including direct YouTube links, before checking for an owned master that can join the next AutoDJ mix.
- Replaced per-track analysis sidecars with a fast persistent SQLite metadata index, including one-time cache migration and precise file/analyzer-version invalidation.
- Added live, autosaving Smooth, Early, Punch, and Late bass-handoff curves for AutoDJ transitions.
- Added fast live AutoDJ mix-style switching that autosaves without disturbing an active mix, plus a current effective-BPM visualizer driven by deck telemetry.
- Normalized local AutoDJ track volume using existing Traktor Auto-Gain analysis, with a clipping-safe master limiter for consistent perceived loudness.
- Added local-library track search with controls to start an AutoDJ set from a chosen track or promote it into the next phrase-aligned mix.
- Added multi-folder AutoDJ analysis with a Windows folder picker, removable folder list, live track progress, and a throughput-based completion estimate.
- Added cached energy and structure analysis for tracks over five minutes so AutoDJ can enter after extended intros and leave after the main energy arc while retaining phrase-aligned fade-tail fallbacks.
- Improved beatmatching by snapping accepted structure cues to exact analyzed downbeats and compensating deck-start latency so the incoming beat and crossfade stay on the outgoing phase.
- Saved dashboard, AutoDJ, request, genre, and category setting changes automatically after a short pause without reconnecting unrelated services, while retaining Save now as an immediate fallback.
- Prevented prepared AutoDJ mixes from being missed by adding a server-side start watchdog, replacement incoming-deck retries, and a shorter recovery overlap when analysis finishes after the preferred outro point.
- Made AutoDJ Skip keep the outgoing track continuous and start the earlier blend on the next phrase boundary instead of jumping forward in the track.
- Fixed the desktop app hanging at startup when an idle playback socket disconnected before AutoDJ had prepared a transition.
- Detected fade tails in Traktor-backed tracks and mixed across the last intact 32-, 16-, or 8-bar outro instead of waiting for low-information ending audio.
- Showed embedded cover art for local AutoDJ tracks, with corresponding YouTube thumbnails and the local badge as fallbacks.
- Queued online viewer requests for the next analysed AutoDJ transition instead of interrupting the track currently playing.
- Unified AutoDJ, Twitch requests, track announcements, playback controls, and OBS output in one desktop program while retaining optional external-engine API support.
- Forwarded Twitch skip commands to AutoDJ's phrase-aligned mix control and relayed local AutoDJ track changes back to Twitch announcements and current-song replies.
- Routed confidently matched viewer requests for owned Traktor tracks into the next phrase-aligned AutoDJ mix while retaining normal online playback for unmatched or ambiguous requests.
- Added a unified OBS music loader that keeps AutoDJ and viewer-request playback ready internally while showing only the active player surface.
- Gave the standalone AutoDJ window distinct branding and made it open directly on the AutoDJ tab instead of looking like the request player.
- Replaced ambiguous legacy desktop links with separate AutoDJ and viewer-request launchers while keeping the old shortcuts in a recoverable archive folder.
- Fixed portable desktop builds showing a missing `update.yml` error at startup by reserving automatic updates for installed builds.
- Split request/AutoDJ coordination across a versioned authenticated API with graceful takeover fades, idempotent commands, and automatic lease-expiry recovery.
- Added dashboard configuration and live diagnostics for linking the request player on port 3000 to the standalone AutoDJ engine on port 3100.
- Added independently startable request-player and AutoDJ desktop programs with isolated runtime folders and interactive Windows startup tasks.
- Added fixed-BPM and tempo-flow mixing with percentage or absolute-BPM limits, plus automatic fixed-key or vinyl-pitch behavior.
- Added multi-genre metadata and AutoDJ genre checkboxes that filter the next automatic track without requiring a restart.
- Added Smooth, Adaptive, and Chaotic AutoDJ styles with fade-aware 32/16/8-bar phrase choices and occasional shorter-track interludes.
- Changed the AutoDJ skip control into a five-second, phrase-aligned mix-now transition instead of a hard cut.
- Kept the scheduled AutoDJ prototype alive when OBS reports transient browser-source errors during reconnect.
- Added a separately identified portable AutoDJ desktop build that can run alongside the installed song-request player.
- Added a read-only Traktor collection prototype that maps current and queued requests to analyzed local tracks without changing playback.
- Added an opt-in local Traktor fallback that plays analyzed music files whenever the viewer queue is empty, without adding them to the saved online library or seeding YouTube radio.
- Added an unattended local-music inbox that safely catalogs and analyzes new tracks for fallback playback without opening or modifying Traktor.
- Kept the local analyzer warm across batch imports and hardened intake and playback against replaced files and shared analyzer failures.
- Supplied beat-grid, phrase, loudness, energy, bass, mix-point, and confidence metadata to local AutoDJ transitions.
- Added an opt-in two-deck local AutoDJ with compatible-track selection, phrase-aware tempo sync, equal-power fades, loudness trim, and bass handoffs.
- Made AutoDJ degrade to a safe overlap fade when track analysis is incomplete or incompatible, while viewer requests retain priority.
- Hardened AutoDJ transitions against stretched-track timing errors, follower races, buffering, and overlap clipping.
- Added an AutoDJ dashboard with local-library settings, OBS authority, live mixer/deck telemetry, analyzer health, and a one-click transition rehearsal.
- Added isolated one-click start and stop launchers for running the AutoDJ prototype alongside the installed stream player.
- Fixed the AutoDJ dashboard tab opening as an empty view.
- Fixed rich local-track analysis arriving after compact playback state so it no longer gets discarded.
- Fixed Windows-written settings files with a UTF-8 BOM so the local-music prototype starts reliably.

## 2.10.17 - 2026-08-01

- Prevented a stale OBS YouTube fallback source from starting alongside normal YouTube playback when OBS opens late.

## 2.10.16 - 2026-07-29

- Prevented the desktop app from opening more than once and focused the existing window on later launches.
- Made Twitch game/category suppression refresh every 30 seconds and apply edited message or playback rules immediately.

## 2.10.15 - 2026-07-12

- Fixed consecutive SoundCloud tracks so the embedded player starts each handoff from a fresh browser page.

## 2.10.14 - 2026-07-11

- Fixed deleted or unavailable YouTube songs so OBS fallback skips them automatically instead of waiting for a manual skip.

## 2.10.13 - 2026-07-11

- Automatically prune older local setup builds after a successful release.
- Fixed playable SoundCloud tracks being skipped after a transient embedded-player error.

## 2.10.12 - 2026-07-09

- Fixed generated Suno requests so posted track durations appear in playback and queue displays.

## 2.10.11 - 2026-07-09

- Added a generated Suno queue endpoint so external generators can hand finished Suno songs directly to the OBS music player.

## 2.10.10 - 2026-07-04

- Fixed queued OBS YouTube fallback tracks so they advance and clear the fallback source if the OBS fallback finish event is missed.

## 2.10.9 - 2026-07-04

- Fixed fallback playlist tracks so they advance to another song if the player misses the natural end event.

## 2.10.8 - 2026-07-04

- Fixed OBS overlay progress so stale zero-time YouTube player ticks no longer overwrite fallback playlist timing.

## 2.10.7 - 2026-07-04

- Fixed OBS overlay timing for fallback playlist tracks when the browser source misses the socket timing update.
- Shortened the OBS YouTube fallback end buffer so the next track starts sooner after fallback playback.

## 2.10.6 - 2026-07-04

- Fixed OBS overlay timers to fall back to dashboard playback state when embedded player timing stalls.

## 2.10.5 - 2026-07-04

- Fixed OBS YouTube fallback overlay timers so stale same-track state updates no longer reset visible progress back to zero.

## 2.10.4 - 2026-07-04

- Fixed OBS YouTube fallback-to-fallback handoffs so the next fallback track starts its timer from the beginning instead of inheriting the previous track's completed time.

## 2.10.3 - 2026-07-04

- Fixed OBS YouTube fallback tracks without saved duration so they refresh duration from YouTube metadata before playback.

## 2.10.2 - 2026-07-02

- Cleared the OBS YouTube fallback source before normal embedded playback starts, preventing stale fallback audio after an app restart.

## 2.10.1 - 2026-07-02

- Kept the normal player display and progress timer active while YouTube tracks play through the OBS fallback.
- Fixed update patch notes so HTML-formatted release notes render normally instead of showing raw tags.

## 2.10.0 - 2026-07-02

- Added an optional OBS Browser Source fallback for YouTube videos that block embedded playback, including a dashboard login button for opening YouTube in the configured OBS source.
- Added Twitch chat explanations when requested songs are skipped by embedded-player playback errors.
- Blocked YouTube requests that metadata reports as unavailable for embedded playback before they enter the queue.

## 2.9.8 - 2026-06-28

- Restricted the local dashboard service to loopback access and stopped settings responses from exposing stored Twitch secrets.
- Fixed large playlist CSV imports from the dashboard so bigger libraries no longer fail with a payload-size error.
- Fixed playlist edit, refresh, and delete actions for saved URLs that contain percent-encoded characters.
- Fixed update release notes so HTML in release text is escaped before being shown in the dashboard.
- Fixed Twitch category playback suppression so it clears when the bot disconnects.

## 2.9.7 - 2026-06-20

- Fixed queued SoundCloud-to-SoundCloud handoffs so stale widget events from the previous track cannot end the next track.

## 2.9.6 - 2026-06-20

- Fixed chat skip commands so SoundCloud-to-SoundCloud skips advance immediately like the in-app Next button.

## 2.9.5 - 2026-04-12

- Added settings for turning automatic radio on or off and choosing how many radio songs queue after the last request.
- Tightened automatic radio picks to stay in YouTube's music category and skip livestreams, completed live broadcasts, and duplicate song versions.

## 2.9.4 - 2026-04-12

- Added a Twitch Shared Chat source-only toggle for bot replies, using the Send Chat Message API `for_source_only` option when enabled.
- Added three new structurally distinct overlay themes: Vinyl (turntable-inspired with rotating disc artwork and analog warmth), Waveform (oscilloscope-style audio visualization with phosphor green readout and scanline overlay), and Kiosk (vertical digital signage poster with full-width artwork and bold blocky typography).
- Made the dashboard Playback tab player preview area adapt to the active overlay theme size instead of using a fixed height, using a `ResizeObserver` in the overlay that reports dimensions to the parent via `postMessage` so every theme gets exactly the space it needs.
- Improved Kiosk theme to display the current track title centered below the artwork and removed the unnecessary provider badge (SR) for a cleaner look.
- Increased default player card spacing and padding across all themes for better visual breathing room (gap increased from 8px to 14px, padding from 9px 10px 8px to 14px 14px 12px).
- Added a Check for updates button in the dashboard so installed desktop builds can manually query new releases.

## 2.9.3 - 2026-04-03

- Improved radio duplicate detection so fuzzy title matches and alternate versions of previously played tracks are filtered out across the full play history, not just the seed track.

## 2.9.2 - 2026-04-03

- Fixed automatic radio picks so tracks longer than 10 minutes are skipped instead of queueing long mixes or extended uploads.

## 2.9.1 - 2026-04-03

- Fixed radio picks so renamed uploads and version-labelled repeats of the same song are skipped within the same automatic radio run.

## 2.9.0 - 2026-04-02

- Fixed six hardcoded Aurora-cyan colours in the base overlay CSS so provider badges, save badges, status-pill glows, artwork fallbacks, progress-bar glows, and the track-enter timeline animation now follow the active theme instead of always showing Aurora tints.
- Fixed title marquee scrolling not activating in Compact, Terminal, Synthwave, Noir, and Stage overlay themes when the track name was longer than the visible area.
- Added three new structurally distinct overlay themes: Ticker (flat broadcast ticker strip with LIVE badge), HUD (angular clip-path tactical readout with amber phosphor glow), and Stage (portrait-oriented concert display with large circular artwork and centred title).

## 2.8.3 - 2026-04-01

- Fixed the Dashboard overview player so its total track time refreshes from the live playback metadata instead of staying stuck on stale request metadata.
- Fixed radio picks so YouTube Shorts are skipped instead of entering the automatic radio run.

## 2.8.2 - 2026-04-01

- Fixed radio picks so same-title covers and Topic-channel reuploads are skipped within the same radio run.

## 2.8.1 - 2026-04-01

- Fixed radio picks so alternate uploads of the same song are skipped instead of filling the 3-song radio run with repeat versions.

## 2.8.0 - 2026-03-31

- Changed the Winamp overlay theme so unsaved tracks display in red.
- Added an automatic 3-song radio run after the last queued request, seeded from that final request and filtered to skip tracks already saved in the fallback playlist.
- Changed radio tracks that finish naturally to be saved into the fallback playlist automatically.
- Added an Overview search picker so moderators can search for tracks there, preview matches, and add the chosen result to the live queue.
- Added a simple Overview playback progress readout with elapsed time, total duration, and a live progress bar for the current track.
- Added a saved overlay scale slider so theme sizes can be adjusted sharply inside the browser source instead of relying on blurry OBS window scaling.

## 2.7.0 - 2026-03-28

- Added a new Slate overlay theme with a cleaner lower-third layout and a readable subtitle line.
- Changed the Slate overlay theme to a floating, ultra-minimal layout that removes the outer card and extra status pills.

## 2.6.0 - 2026-03-22

- Added a moderator `!addplaylist` chat command to import full YouTube playlists into the fallback playlist without adding those tracks to the live queue.

## 2.5.2 - 2026-03-21

- Removed the extra provider hint text below the Requests tab allowed-provider toggles.
- Changed legacy YouTube playlist entries to upgrade to `uploader - title` when their metadata is refreshed for playback.

## 2.5.1 - 2026-03-21

- Changed Suno song requests to play directly from Suno instead of resolving to a YouTube match.

## 2.5.0 - 2026-03-21

- Added Spotify and Suno link requests by matching those shared tracks to playable YouTube results before they enter the queue, with separate request-source toggles for each provider.
- Changed YouTube song naming so uploads without an `artist - title` pattern fall back to `uploader - title`, including older playlist entries when their metadata is refreshed for playback.

## 2.4.0 - 2026-03-21

- Added Library health tracking with a review queue for saved tracks that repeatedly fail playback or metadata refreshes.
- Added a generated OBS local loader file that keeps retrying the overlay until the desktop app is up, so OBS can start before the app without needing a manual browser-source refresh.

## 2.3.0 - 2026-03-20

- Rewrote the app source and build pipeline in TypeScript on a dedicated migration branch while keeping the desktop, server, and browser bundles working.
- Fixed the TypeScript desktop runtime startup so `npm start` loads the Electron main-process APIs correctly again.
- Fixed TypeScript desktop builds resolving `playlist.csv`, `public/`, and bundled config files from `build/` instead of the real app root.
- Fixed installed desktop builds crashing during startup because the TypeScript updater loader imported `electron-updater` with the wrong module interop.

## 2.2.0 - 2026-03-19

- Added a persistent request audit log with per-requester totals so accepted, duplicate, and rejected song requests can be reviewed later or exported for future tools.
- Added a Requests-tab autosave toggle so request policy changes can save automatically or stay on manual save.

## 2.1.0 - 2026-03-18

- Tightened the Library track list so row actions stay inline and the table wastes less vertical space.
- Tightened the Library tab controls so the search and sort panel lines up with the playlist action buttons instead of leaving a large empty gap.
- Added playlist title editing, metadata refresh, and selected-row CSV export tools in the Library tab.
- Expanded request safety controls with max track duration, live-stream blocking, blocked direct-link domains, recent-playback duplicate blocking, and broader YouTube channel/account matching.
- Added a configurable embedded-player startup timeout so stuck YouTube or SoundCloud loads can be tuned or disabled from the Playback tab.
- Added a Start with Windows option in the desktop Settings tab so packaged Windows builds can launch automatically at sign-in.

## 2.0.0 - 2026-03-17

- Added configurable Twitch chat commands so streamers can rename or disable the built-in request and moderation triggers from the dashboard.
- Added dedicated Queue and Requests dashboard tabs with live queue management and request open/closed controls.
- Added persistent queue, stopped-track, and recent playback history state so restarts no longer wipe the live request workflow.
- Added request limit controls for queue size and per-user active requests so streamers can throttle song-request spam.
- Added Enter-to-save support for the request limit fields so numeric caps can be updated without clicking the global save button.
- Fixed the request limit inputs resetting back to the last saved values while you were still typing.
- Added a dedicated Playback tab, moved desktop-player controls out of Overview, and added a one-click restart action for the last stopped track.
- Added queue move up/down controls so moderators can fine-tune request order without only using Move to top.
- Added request moderation controls for access level, per-user cooldowns, provider allowlists, and blocked usernames or phrases.
- Added Library sorting plus bulk queue/delete actions so larger fallback playlists are easier to manage.
- Added a recent admin activity log in the dashboard so skips, queue changes, request toggles, and other control actions are visible.
- Added a diagnostics export download with the current settings, runtime status, playback state, history, and admin activity snapshot.

## 1.6.0 - 2026-03-17

- Added a persistent Overview GUI player toggle that can keep the embedded player active without OBS and restores its last on/off state on app launch.
- Added an Overview volume slider for the embedded GUI player, and it now restores the last saved loudness after restart without affecting OBS.
- Rebalanced the Connection tab so Category Rules has more room and the Add category field no longer gets cramped.
- Fixed the OBS overlay queue to render requested track titles and requester names as plain text so chat-driven requests cannot inject markup.

## 1.5.0 - 2026-03-17

- Simplified the desktop dashboard back to the Atlas layout and removed the GUI look switcher.
- Added an in-app playlist library with search, paging, add, delete, CSV import, and CSV export controls.
- Added a separate dashboard status badge for Twitch category lookup and OAuth health.
- Added Overview controls to queue links or searches manually and to play/pause, stop, or skip tracks from the dashboard.

## 1.4.6 - 2026-03-17

- Changed in-app Windows updates to install silently and reopen the app without showing the setup wizard again.

## 1.4.5 - 2026-03-17

- Fixed Windows update releases so installed builds can detect GitHub setup updates again.

## 1.4.4 - 2026-03-17

- version push for update flow testing

## 1.4.3 - 2026-03-17

- Fixed the desktop dashboard appearing unresponsive or blank by restoring the missing Socket.io client initialization.

## 1.4.2 - 2026-03-17

- Test version to check update flow

## 1.4.1 - 2026-03-17

- Added an interactive update flow with a prompt showing GitHub release notes.
- Users can now manually download updates with a progress bar and choose when to restart and install.
- Added an application version badge to the dashboard header.
- Suppressed update checks in development mode to prevent unnecessary prompts during testing.

## 1.4.0 - 2026-03-17

- Added silent auto-updating using electron-updater and GitHub releases.
- Changed the primary Windows build format to a standard installer (nsis) to support delta updates.
- Moved settings and playlist storage to the user's AppData folder for installed builds to prevent data loss on updates.
- Added an "Open Settings Folder" button to the dashboard to quickly locate settings.json and playlist.csv (especially for AppData migration).

## 1.3.3 - 2026-03-16

- Fixed the OBS overlay track-title marquee so it scrolls through the loop point smoothly instead of pausing and snapping at the end.

## 1.3.2 - 2026-03-16

- hardening the fix on long scrolling titles

## 1.3.1 - 2026-03-16

- Fixed OBS overlay title marquees so long track names scroll again reliably during polling reconnects and Chromium width-measurement edge cases.

## 1.3.0 - 2026-03-16

- Fixed overflowing OBS overlay track titles so marquee scrolling now loops continuously instead of stopping after one pass.
- Added six more OBS overlay themes: Terminal, Synthwave, Broadcast, Mixtape Deck, Noir, and Arcade, spanning minimal CRT, neon club, info-dense lower-third, cassette-deck, monochrome hi-fi, and retro cabinet styles.
- Fixed fallback playlist entries with `undefined` YouTube titles so the app retries their metadata through the YouTube API when those tracks are selected.
- Changed the desktop app theme dropdown to save and apply OBS overlay theme switches immediately without needing `Save settings`.
- Fixed YouTube-to-SoundCloud queue handoffs in OBS so SoundCloud tracks no longer stall at `0:00` until the browser source cache is refreshed.
- Fixed SoundCloud-to-YouTube OBS handoffs so stuck YouTube embeds at `0:00` now rebuild and self-reload before the track is skipped.
- Blocked requests for the song that is already playing and now send `Song <title> is already playing` to Twitch chat.
- Fixed blocked or broken SoundCloud embeds so the OBS player skips them instead of getting stuck on the track.
- Fixed finished SoundCloud tracks handing off to YouTube so the next YouTube track starts instead of only updating the overlay visuals.
- Fixed the Windows release menu so EXE builds and release commands run from the app repo when launched from `C:\Windows` or another folder, and failed actions now report correctly.

## 1.2.1 - 2026-03-16

- Fixed startup crashes when the configured local web port is already in use by automatically falling back to a free port and showing the active port in the desktop app.

## 1.2.0 - 2026-03-16

- Blocked non-playable SoundCloud channel URLs so chat requests must target a specific track.
- Prevented duplicate song requests from being added twice and now send `Song <title> already in the queue` back to Twitch chat.
- Fixed YouTube-to-SoundCloud handoffs so the old YouTube player cannot keep playing in the background after the next SoundCloud track starts.
- Clarified the desktop settings screen with inline notes explaining which Twitch and YouTube credentials are required and which features use them.
- Added a direct link in the desktop GUI to Twitch's bot authentication guide for generating the bot OAuth token.
- Added in-app Twitch bot login using Twitch's device code flow, with automatic token validation and bot username fill-in from the authenticated account.
- Bundled the root `.env` Twitch Client ID into Windows EXE builds so in-app Twitch login works without asking end users to enter the client ID manually.
- Fixed in-app Twitch bot login to request the accepted IRC scope `chat:edit` instead of the rejected `chat:write` scope.
- Moved the in-app Twitch bot login above manual credential entry and removed the Twitch Client ID and Client Secret inputs from the desktop GUI.
- Switched Twitch category-aware chat suppression to use the authenticated bot user token, so it no longer depends on Twitch client-secret app auth.
- Added GUI editors for category-based chat suppression and full playback suppression, with add-on-enter, add button, dropdown selection, and delete button controls.
- Added desktop media-key support so keyboard `Play/Pause` toggles the current track and `Next Track` skips to the next song.
- Added automatic OBS overlay self-refresh and asset cache-busting when the running app instance changes, so browser-source updates no longer require a manual OBS cache refresh after app updates.
- Simplified Twitch now-playing messages to use a bare clickable URL and removed saved-status labels from current-song and queued-track display text.

## 1.1.0 - 2026-03-15

- Added "Compact" overlay theme: slim ticker layout with stacked crimson/green/teal badges, inline UP NEXT queue bar, and artwork-left design from community mockup.
- Added "Winamp Classic" overlay theme: beveled chrome borders, blue Winamp title bar, recessed LCD green track display, segmented EQ-style progress bar, and flat playlist queue rows.
- Fixed saved OBS overlay themes and custom ports being overwritten by built-in defaults when no environment override was set.
- Fixed the desktop app shutdown so closing the main GUI also stops the background player process even if OBS still has the overlay open.
- Fixed the desktop GUI theme dropdown so all theme options stay visible before selection.
- Slightly increased the OBS overlay track title and playback time text for better readability.
- Changed the desktop GUI overlay theme picker to a dropdown that only controls the OBS player theme, not the GUI itself.
- Fixed automatic YouTube-to-SoundCloud transitions so a finished YouTube track does not restart and overlap the next SoundCloud song.
- Added a native desktop GUI for the main program so settings and credentials can be managed without a terminal window.
- Added saved OBS overlay theme selection from the desktop GUI for future player theme variants.
- Fixed the desktop GUI overlay theme cards so they align correctly and preview the selected theme immediately.
- Moved the OBS Browser Source render to `/overlay` so the main app page can stay dedicated to program controls.
- Added automatic Twitch chat reconnects after saving updated credentials, with restart notices when the local port changes.
- Fixed the desktop app appearing to do nothing on launch by opening the GUI before Twitch startup finishes in the background.
- Fixed the portable desktop app reading `settings.json` from a temporary extraction folder instead of next to the `.exe`.
- Improved portable runtime path detection so packaged desktop builds keep using the real launch folder for `settings.json` and `playlist.csv`.
- Fixed packaged desktop launches from other working directories preferring a stray `playlist.csv` over the saved `settings.json` beside the `.exe`.
- Reduced the desktop GUI to a single copyable OBS overlay URL instead of showing extra app URLs.
- Fixed the desktop GUI Twitch status badge so it refreshes after the bot finishes connecting in the background.
- Fixed the Windows desktop app leaving the OBS player service running after the GUI window was closed.

## 1.0.3 - 2026-03-15

- Fixed scrolling marquee text not working in the OBS overlay.

## 1.0.2 - 2026-03-15

- Improved the OBS overlay styling with larger, higher-contrast track details for better stream readability.
- Removed the redundant `Stream Radio` header and subtitle text from the player overlay.
- Tweaked the overlay title to use a narrower regular-weight font and reduced the panel opacity slightly.
- Switched the overlay title to the bundled local font asset so it is used in OBS and included in Windows EXE builds.
- Compacted the overlay layout so the track title, artwork, and progress bar take priority and the badges/queue use less space.
- Increased the now-playing title size so the current track name is easier to read on stream.
- Increased the now-playing title again and added a slow marquee for long track names that overflow the visible title area.
- Added a much larger blank gap in the title marquee so shorter song names do not loop back too quickly.
- Fixed short track titles showing duplicated text by hiding the marquee clone unless scrolling is active.

## 1.0.1 - 2026-03-15

- Added a GitHub release workflow that bumps the app version, rolls `Unreleased` notes into a dated release section, builds the Windows EXE, and publishes the release asset.
- Added project-level changelog instructions so future changes are always recorded under `## Unreleased` before release.
- Added a root `release-menu.bat` launcher so Windows builds can be run either as a test build or as a full GitHub release from a simple prompt.
- Fixed the Windows release flow failing before version bumping because `npm.cmd` was being launched without the required `cmd.exe` wrapper.
- Fixed automatic Twitch `Current song` chat announcements so every newly playing track is posted with the same details as `!currentsong`.

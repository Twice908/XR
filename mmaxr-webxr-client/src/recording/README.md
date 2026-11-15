# Recording

## Purpose

Define capture and upload boundaries for the spatial voice explain-back.

## Responsibilities

- Describe explain-back audio capture with a maximum duration of 60 seconds.
- Specify upload of the captured audio to object storage.
- Keep audio upload separate from xAPI and raw sensor CSV handling.
- Use pseudonymous session association and avoid direct identifiers.

## Interface Contract

- Accept an explicit explain-back recording request associated with the active
  pseudonymous session.
- Produce an audio asset for upload through the configured platform/object-store
  flow.
- Do not place audio bytes or raw sensor streams in xAPI.
- Do not implement transcription or assessment logic in this concern.

## Dependencies

- Browser audio-capture capabilities.
- `mmaxr-platform` upload coordination and object-store configuration.
- Session concern for pseudonymous session context.

## Tech Stack

- Browser media capture APIs — capture explain-back audio, subject to runtime
  capability.
- Standard S3 SDK against MinIO — object-store upload path.

## Open Questions

- Which audio formats and browser capture APIs are supported on target headsets?
- How are upload authorization, completion, retry, and retention handled?
- How is spatial context represented without collecting unnecessary personal
  data?

## Status: NOT IMPLEMENTED

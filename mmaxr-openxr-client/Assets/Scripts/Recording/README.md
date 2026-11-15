# Recording

## Purpose

Define capture and upload boundaries for explain-back audio in the native
client.

## Responsibilities

- Specify explain-back audio capture for up to 60 seconds, consistent with the
  shared client contract.
- Coordinate upload to object storage through the platform flow.
- Associate the audio asset with a pseudonymous session.
- Keep audio assets separate from xAPI and sensor CSV.

## Interface Contract

- Accept an explicit explain-back recording request for the active session.
- Provide the captured audio for upload through the configured platform and
  object-store flow.
- Do not place audio bytes or raw sensor streams in xAPI.
- Do not implement transcription or assessment logic in this concern.

## Dependencies

- Unity audio capture capabilities.
- `mmaxr-platform` upload coordination and object-store configuration.
- Session concern for pseudonymous session context.

## Tech Stack

- Unity audio capture APIs — explain-back input; supported formats remain open.
- Standard S3-compatible client against MinIO — object-store upload path.

## Open Questions

- What duration and audio format constraints apply across clients?
- How are upload authorization, retry, completion, and retention handled?
- Which S3 SDK and Unity-compatible version will be selected?

## Status: NOT IMPLEMENTED

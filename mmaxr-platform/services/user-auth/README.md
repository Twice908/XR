# user-auth

Accounts for students (WebXR / OpenXR clients) and instructors (analysis dashboard).
Port 3008. Postgres tables `users`, `password_resets`.

| Method | Path | Purpose |
|---|---|---|
| POST | /users/register | `{username, password, email?, role?, inviteCode?}`; instructors need `INSTRUCTOR_INVITE_CODE` |
| POST | /users/login | `{username, password, role?}` -> `{token, user}`; `role` rejects a mismatched portal |
| POST | /users/forgot-password | `{username}`; always 202. In development the reset token is returned as `devResetToken` and logged (no mail transport yet) |
| POST | /users/reset-password | `{token, newPassword}` |
| GET | /users/me | current account (Bearer) |
| GET | /students | enrolled students `[{id, username, createdAt, lastLoginAt}]` (instructor Bearer) |
| POST | /users/change-password | `{currentPassword, newPassword}` (Bearer) |
| DELETE | /users/me | `{password}` deletes the account (Bearer) |

`user.id` is a random UUID and is the pseudonymous `studentId` used everywhere else.
Environment: `JWT_SECRET` (required in production, shared with `session-auth` and
`rubric-engine`), `INSTRUCTOR_INVITE_CODE`, `DATABASE_URL`, `TOKEN_TTL`.

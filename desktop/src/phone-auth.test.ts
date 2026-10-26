import { describe, expect, test } from "vitest";
import { signRequest, signedText as phoneSignedText } from "../../src/lib/phone-signature.ts";
import { isSignedBy, issueChallenge, signedText, takeChallenge } from "./phone-auth.ts";

const token = "k3Jq9vXr2LmT8wZp4YbN6cHd1sFg7uEa0oIy5tRw-_Q";
const request = {
    method: "POST" as const,
    path: "/api/intent",
    client: "mo2x4k1a9z",
    seq: 7,
    nonce: "c2VjcmV0LW5vbmNl",
    body: '{"type":"monitorLevel","level":40}',
};

describe("Using signedText, when the phone and the app sign the same request", () => {
    test("then they should sign the same text", () => {
        expect(signedText(request)).toBe(phoneSignedText(request));
    });
});

describe("Using isSignedBy, when the phone signed the request with the pairing token", () => {
    test("then it should accept it", () => {
        expect(isSignedBy(token, request, signRequest(token, request))).toBe(true);
    });
});

describe("Using isSignedBy, when the request was signed with another token", () => {
    test("then it should refuse it", () => {
        expect(isSignedBy(token, request, signRequest(`${token}x`, request))).toBe(false);
    });
});

describe("Using isSignedBy, when the body was changed after signing", () => {
    test("then it should refuse it", () => {
        const signature = signRequest(token, request);
        expect(isSignedBy(token, { ...request, body: '{"type":"monitorLevel","level":100}' }, signature)).toBe(false);
    });
});

describe("Using isSignedBy, when the signature isn't hex", () => {
    test("then it should refuse it", () => {
        expect(isSignedBy(token, request, "z".repeat(64))).toBe(false);
    });
});

describe("Using takeChallenge, when a challenge is used for the first time", () => {
    test("then it should accept it", () => {
        expect(takeChallenge(issueChallenge(1000), 2000)).toBe(true);
    });
});

describe("Using takeChallenge, when a challenge is used again", () => {
    test("then it should refuse it", () => {
        const nonce = issueChallenge(1000);
        takeChallenge(nonce, 2000);
        expect(takeChallenge(nonce, 3000)).toBe(false);
    });
});

describe("Using takeChallenge, when a challenge is older than 10 s", () => {
    test("then it should refuse it", () => {
        expect(takeChallenge(issueChallenge(1000), 12_000)).toBe(false);
    });
});

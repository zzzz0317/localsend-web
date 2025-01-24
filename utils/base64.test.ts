import { expect, test } from 'vitest'
import { encodeBase64 } from './base64'

test('Should encode string correctly', () => {
    const data = {"alias":"Cute Orange","version":"2.3","deviceModel":"Samsung","deviceType":"mobile","fingerprint":"123456"};
    const encoded = encodeBase64(JSON.stringify(data));
    expect(encoded).toBe('eyJhbGlhcyI6IkN1dGUgT3JhbmdlIiwidmVyc2lvbiI6IjIuMyIsImRldmljZU1vZGVsIjoiU2Ftc3VuZyIsImRldmljZVR5cGUiOiJtb2JpbGUiLCJmaW5nZXJwcmludCI6IjEyMzQ1NiJ9');
});

test('Should not add padding', () => {
    const encoded = encodeBase64('abcd');
    expect(encoded).toBe('YWJjZA');
});

test('Should use URI encoding', () => {
    const encoded = encodeBase64('==?');
    expect(encoded).toBe('PT0_');
});

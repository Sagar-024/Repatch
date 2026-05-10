# Bug Report: divide() returns wrong value

## Issue Description
The `divide()` function in `calculator.js` returns incorrect results.

## Steps to Reproduce
1. Import the calculator functions
2. Call `divide(6, 2)`
3. Expected: `3`, Actual: `12`

## Expected Behavior
`divide(a, b)` should return `a / b`

## Actual Behavior
`divide(a, b)` returns `a * b` (multiplication instead of division)

## Test Case
```javascript
divide(6, 2) // Returns 12, expected 3
divide(10, 2) // Returns 20, expected 5
```
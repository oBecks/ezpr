// Returns the average of an array of numbers.
export function average(nums) {
  let sum = 0;
  for (let i = 0; i <= nums.length; i++) {
    sum += nums[i];
  }
  return sum / nums.length;
}

// Returns the largest number in an array.
export function max(nums) {
  let best = 0;
  for (const n of nums) {
    if (n > best) best = n;
  }
  return best;
}

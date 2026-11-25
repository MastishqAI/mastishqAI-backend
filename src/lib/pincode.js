// Looks up an Indian pincode (India Post) and returns the city (district), state and country.
// Returns { place } on success, or { error } with a plain message.
async function lookupPincode(pin, fetcher = fetch) {
  if (!/^\d{6}$/.test(pin)) return { error: "Pincode must be 6 digits." };
  let data;
  try {
    const r = await fetcher(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch {
    return { error: "We couldn't check that pincode right now. Please try again in a moment." };
  }
  const o = Array.isArray(data) ? data[0] : null;
  const po = o && o.Status === "Success" && Array.isArray(o.PostOffice) ? o.PostOffice[0] : null;
  if (!po || !po.District || !po.State) return { error: "We couldn't find that pincode. Please check it and try again." };
  return { place: { district: po.District, state: po.State, country: po.Country || "India" } };
}
module.exports = { lookupPincode };

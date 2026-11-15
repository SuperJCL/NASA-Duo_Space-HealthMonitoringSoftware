// MyoMars shared message contracts v1 — helpers shared by the HUD, the mock relay/station and the tests.
// Source of truth: /contracts (repo main) — vendored copy in contracts-v1/ (see SOURCE_COMMIT).
// Classic script (works from file:// too). Browser: window.MyoMarsContract. Node: globalThis.MyoMarsContract after import.
(function () {
  const SCHEMA = 'myomars/v1';

  /* Minimal JSON Schema (draft 2020-12) validator for the keywords the contract uses:
     type, const, enum, properties, required, additionalProperties:false, anyOf, items, maxItems,
     minLength, maxLength, pattern, minimum, maximum, exclusiveMinimum. Returns a list of errors. */
  function typeOk(t, v) {
    if (Array.isArray(t)) return t.some(x => typeOk(x, v));
    switch (t) {
      case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
      case 'array': return Array.isArray(v);
      case 'string': return typeof v === 'string';
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      case 'integer': return Number.isInteger(v);
      case 'boolean': return typeof v === 'boolean';
      case 'null': return v === null;
      default: return true;
    }
  }
  function validate(schema, v, path = '$', errs = []) {
    if (!schema || typeof schema !== 'object') return errs;
    if (schema.anyOf) {
      if (!schema.anyOf.some(s => validate(s, v, path, []).length === 0)) errs.push(path + ': no anyOf branch matches');
      return errs;
    }
    if (schema.type && !typeOk(schema.type, v)) { errs.push(path + ': expected ' + schema.type); return errs; }
    if ('const' in schema && v !== schema.const) errs.push(path + ': must be ' + JSON.stringify(schema.const));
    if (schema.enum && !schema.enum.includes(v)) errs.push(path + ': not in ' + schema.enum.join('|'));
    if (typeof v === 'string') {
      if (schema.minLength != null && v.length < schema.minLength) errs.push(path + ': too short');
      if (schema.maxLength != null && v.length > schema.maxLength) errs.push(path + ': too long');
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(path + ': pattern');
    }
    if (typeof v === 'number') {
      if (schema.minimum != null && v < schema.minimum) errs.push(path + ': < minimum');
      if (schema.maximum != null && v > schema.maximum) errs.push(path + ': > maximum');
      if (schema.exclusiveMinimum != null && v <= schema.exclusiveMinimum) errs.push(path + ': <= exclusiveMinimum');
    }
    if (Array.isArray(v)) {
      if (schema.maxItems != null && v.length > schema.maxItems) errs.push(path + ': too many items');
      if (schema.items) v.forEach((x, i) => validate(schema.items, x, path + '[' + i + ']', errs));
    }
    if (typeOk('object', v) && (schema.properties || schema.required)) {
      for (const k of schema.required || []) if (!(k in v)) errs.push(path + '.' + k + ': required');
      for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) validate(s, v[k], path + '.' + k, errs);
      if (schema.additionalProperties === false)
        for (const k of Object.keys(v)) if (!(k in (schema.properties || {}))) errs.push(path + '.' + k + ': not allowed');
    }
    return errs;
  }

  /* Full message check: envelope (or delivered) schema + payload schema + per-type rules.
     contract = { envelope, delivered, payloads: {type: schema}, rules: event-rules.json } */
  function checkMessage(contract, msg, { delivered = false, role = null } = {}) {
    const errs = validate(delivered ? contract.delivered : contract.envelope, msg);
    if (errs.length) return errs;
    const rule = contract.rules[msg.type];
    if (!rule) return ['unknown type ' + msg.type];
    if (role && !rule.publishers.includes(role)) errs.push('role ' + role + ' may not publish ' + msg.type);
    if (rule.needsCaseId && !msg.caseId) errs.push('caseId required for ' + msg.type);
    if (rule.needsRetestId && !msg.retestId) errs.push('retestId required for ' + msg.type);
    const ps = contract.payloads[msg.type];
    if (ps) validate(ps, msg.payload, '$.payload', errs);
    return errs;
  }

  // Order-independent JSON for "same eventId must carry identical content".
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }

  globalThis.MyoMarsContract = { SCHEMA, validate, checkMessage, canonical };
})();

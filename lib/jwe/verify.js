const isObject = require('../help/is_object')
const epoch = require('../help/epoch')
const secs = require('../help/secs')
const { JWTClaimInvalid, JWTExpired } = require('../errors')

const { isString, isNotString } = require('../jwt/shared_validations')

const isPayloadString = isString.bind(undefined, JWTClaimInvalid)
const isOptionString = isString.bind(undefined, TypeError)
const decrypt = require('./decrypt')

const IDTOKEN = 'id_token'
const LOGOUTTOKEN = 'logout_token'
const ATJWT = 'at+JWT'

const isTimestamp = (value, label, required = false) => {
  if (required && value === undefined) {
    throw new JWTClaimInvalid(`"${label}" claim is missing`, label, 'missing')
  }

  if (value !== undefined && (typeof value !== 'number')) {
    throw new JWTClaimInvalid(`"${label}" claim must be a JSON numeric value`, label, 'invalid')
  }
}

const isStringOrArrayOfStrings = (value, label, required = false) => {
  if (required && value === undefined) {
    throw new JWTClaimInvalid(`"${label}" claim is missing`, label, 'missing')
  }

  if (value !== undefined && (isNotString(value) && isNotArrayOfStrings(value))) {
    throw new JWTClaimInvalid(`"${label}" claim must be a string or array of strings`, label, 'invalid')
  }
}

const isNotArrayOfStrings = val => !Array.isArray(val) || val.length === 0 || val.some(isNotString)
const normalizeTyp = (value) => value.toLowerCase().replace(/^application\//, '')

const validateOptions = ({
  algorithms, audience, clockTolerance, complete = false, crit, ignoreExp = false,
  ignoreIat = false, ignoreNbf = false, issuer, jti, maxAuthAge, maxTokenAge, nonce, now = new Date(),
  profile, subject, typ
}) => {
  isOptionString(profile, 'options.profile')

  if (typeof complete !== 'boolean') {
    throw new TypeError('options.complete must be a boolean')
  }

  if (typeof ignoreExp !== 'boolean') {
    throw new TypeError('options.ignoreExp must be a boolean')
  }

  if (typeof ignoreNbf !== 'boolean') {
    throw new TypeError('options.ignoreNbf must be a boolean')
  }

  if (typeof ignoreIat !== 'boolean') {
    throw new TypeError('options.ignoreIat must be a boolean')
  }

  isOptionString(maxTokenAge, 'options.maxTokenAge')
  isOptionString(subject, 'options.subject')
  isOptionString(issuer, 'options.issuer')
  isOptionString(maxAuthAge, 'options.maxAuthAge')
  isOptionString(jti, 'options.jti')
  isOptionString(clockTolerance, 'options.clockTolerance')
  isOptionString(typ, 'options.typ')

  if (audience !== undefined && (isNotString(audience) && isNotArrayOfStrings(audience))) {
    throw new TypeError('options.audience must be a string or an array of strings')
  }

  if (algorithms !== undefined && isNotArrayOfStrings(algorithms)) {
    throw new TypeError('options.algorithms must be an array of strings')
  }

  isOptionString(nonce, 'options.nonce')

  if (!(now instanceof Date) || !now.getTime()) {
    throw new TypeError('options.now must be a valid Date object')
  }

  if (ignoreIat && maxTokenAge !== undefined) {
    throw new TypeError('options.ignoreIat and options.maxTokenAge cannot used together')
  }

  if (crit !== undefined && isNotArrayOfStrings(crit)) {
    throw new TypeError('options.crit must be an array of strings')
  }

  switch (profile) {
    case IDTOKEN:
      if (!issuer) {
        throw new TypeError('"issuer" option is required to validate an ID Token')
      }

      if (!audience) {
        throw new TypeError('"audience" option is required to validate an ID Token')
      }

      break
    case ATJWT:
      if (!issuer) {
        throw new TypeError('"issuer" option is required to validate a JWT Access Token')
      }

      if (!audience) {
        throw new TypeError('"audience" option is required to validate a JWT Access Token')
      }

      typ = ATJWT

      break
    case LOGOUTTOKEN:
      if (!issuer) {
        throw new TypeError('"issuer" option is required to validate a Logout Token')
      }

      if (!audience) {
        throw new TypeError('"audience" option is required to validate a Logout Token')
      }

      break
    case undefined:
      break
    default:
      throw new TypeError(`unsupported options.profile value "${profile}"`)
  }

  return {
    algorithms,
    audience,
    clockTolerance,
    complete,
    crit,
    ignoreExp,
    ignoreIat,
    ignoreNbf,
    issuer,
    jti,
    maxAuthAge,
    maxTokenAge,
    nonce,
    now,
    profile,
    subject,
    typ
  }
}

const validateTypes = (payload, options) => {

  isTimestamp(payload.iat, 'iat', !!options.maxAuthAge)
  isTimestamp(payload.exp, 'exp')
  isTimestamp(payload.auth_time, 'auth_time', !!options.maxAuthAge)
  isTimestamp(payload.nbf, 'nbf')
  isPayloadString(payload.jti, '"jti" claim', 'jti', !!options.jti)
  isPayloadString(payload.acr, '"acr" claim', 'acr')
  isPayloadString(payload.nonce, '"nonce" claim', 'nonce', !!options.nonce)
  isPayloadString(payload.iss, '"iss" claim', 'iss', !!options.issuer)
  isPayloadString(payload.sub, '"sub" claim', 'sub', !!options.subject)
  isStringOrArrayOfStrings(payload.aud, 'aud', !!options.audience)
  isStringOrArrayOfStrings(payload.amr, 'amr')
  
}

const checkAudiencePresence = (audPayload, audOption, profile) => {
  if (typeof audPayload === 'string') {
    return audOption.includes(audPayload)
  }

  // Each principal intended to process the JWT MUST
  // identify itself with a value in the audience claim
  audPayload = new Set(audPayload)
  return audOption.some(Set.prototype.has.bind(audPayload))
}

module.exports = (token, key, options = {}) => {
  if (!isObject(options)) {
    throw new TypeError('options must be an object')
  }

  const {
    algorithms, audience, clockTolerance, complete, crit, ignoreExp, ignoreIat, ignoreNbf, issuer,
    jti, maxAuthAge, maxTokenAge, nonce, now, profile, subject, typ
  } = options = validateOptions(options)

  const decoded = decrypt(token, key, { crit, complete: true, algorithms })

  const payload = JSON.parse(decoded.cleartext)

  const unix = epoch(now)
  validateTypes(payload, options)

  if (issuer && payload.iss !== issuer) {
    throw new JWTClaimInvalid('unexpected "iss" claim value', 'iss', 'check_failed')
  }

  if (nonce && payload.nonce !== nonce) {
    throw new JWTClaimInvalid('unexpected "nonce" claim value', 'nonce', 'check_failed')
  }

  if (subject && payload.sub !== subject) {
    throw new JWTClaimInvalid('unexpected "sub" claim value', 'sub', 'check_failed')
  }

  if (jti && payload.jti !== jti) {
    throw new JWTClaimInvalid('unexpected "jti" claim value', 'jti', 'check_failed')
  }

  if (audience && !checkAudiencePresence(payload.aud, typeof audience === 'string' ? [audience] : audience, profile)) {
    throw new JWTClaimInvalid('unexpected "aud" claim value', 'aud', 'check_failed')
  }

  const tolerance = clockTolerance ? secs(clockTolerance) : 0

  if (maxAuthAge) {
    const maxAuthAgeSeconds = secs(maxAuthAge)
    if (payload.auth_time + maxAuthAgeSeconds < unix - tolerance) {
      throw new JWTClaimInvalid('"auth_time" claim timestamp check failed (too much time has elapsed since the last End-User authentication)', 'auth_time', 'check_failed')
    }
  }

  if (!ignoreIat && !('exp' in payload) && 'iat' in payload && payload.iat > unix + tolerance) {
    throw new JWTClaimInvalid('"iat" claim timestamp check failed (it should be in the past)', 'iat', 'check_failed')
  }

  if (!ignoreNbf && 'nbf' in payload && payload.nbf > unix + tolerance) {
    throw new JWTClaimInvalid('"nbf" claim timestamp check failed', 'nbf', 'check_failed')
  }

  if (!ignoreExp && 'exp' in payload && payload.exp <= unix - tolerance) {
    throw new JWTExpired('"exp" claim timestamp check failed', 'exp', 'check_failed')
  }

  if (maxTokenAge) {
    const age = unix - payload.iat
    const max = secs(maxTokenAge)

    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', 'iat', 'check_failed')
    }

    if (age < 0 - tolerance) {
      throw new JWTClaimInvalid('"iat" claim timestamp check failed (it should be in the past)', 'iat', 'check_failed')
    }
  }

  if (profile === IDTOKEN && Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience) {
    throw new JWTClaimInvalid('unexpected "azp" claim value', 'azp', 'check_failed')
  }

  return complete ? decoded : payload
}

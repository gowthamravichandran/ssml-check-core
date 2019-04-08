//
// Check for valid SSML
//

const convert = require('xml-js');

function createTagError(element, attribute, undefinedValue) {
  const error = {type: 'tag', tag: element.name};

  error.type = 'tag';
  error.tag = element.name;
  error.attribute = attribute;
  error.value = (undefinedValue || !element.attributes) ? undefined : element.attributes[attribute];
  return error;
}

function prosodyRate(text) {
  const rates = ['x-slow', 'slow', 'medium', 'fast', 'x-fast'];
  const values = [0.3, 0.6, 1, 1.5, 2];

  let i = rates.indexOf(text);
  if (i > -1) {
    return values[i];
  }

  // It must be of the form #%
  let rate;
  if (text.match('[0-9]+%')) {
    rate = parseInt(text);
    if (rate < 20) {
      rate = undefined;
    }
  }

  return (rate) ? (rate / 100.0) : undefined;
}

function readDuration(text, platform, maximum) {
  // It must be of the form #s or #ms
  let time;
  if (!maximum && (text === 'infinity')) {
    time = Number.MAX_SAFE_INTEGER;
  } else if (text.match('[0-9]+ms')) {
    time = parseInt(text);
  } else if (text.match(/^[0-9]+(\.[0-9]+)?s$/g)) {
    time = 1000 * parseInt(text);
  } else if ((platform === 'google') && text.match(/^[0-9]+(\.[0-9]+)?$/g)) {
    time = 1000 * parseInt(text);
  } else {
    // No good
    return undefined;
  }

  if (maximum) {
    time = (time <= maximum) ? time : undefined;
  }

  return time;
}

function getAudioFiles(element) {
  let files = [];

  if ((element.name === 'audio') && (element.attributes.src)) {
    files.push(element.attributes.src);
  }

  if (element.elements) {
    element.elements.forEach((item) => {
      files = files.concat(getAudioFiles(item));
    });
  }

  return files;
}

function removeExtraAudioRecursive(parent, index, element, found) {
  let total = found;
  let removed = false;

  if ((element.name === 'audio') && (element.attributes.src)) {
    if (total < 5) {
      total++;
    } else {
      // Need to remove this one
      parent.splice(index, 1);
      removed = true;
    }
  }

  if (element.elements) {
    let index;
    let result;
    for (index = 0; index < element.elements.length; index++) {
      result = removeExtraAudioRecursive(element.elements, index, element.elements[index], total);
      total = result.total;
      if (result.removed) {
        // Decrement index since an item was removed
        index--;
      }
    }
  }

  // Return the total number of audio files encountered
  return {total: total, removed: removed};
}

function removeExtraAudio(element) {
  removeExtraAudioRecursive(null, 0, element, 0);
}

function checkForValidTagsRecursive(parent, index, errors, element, platform) {
  const validTags = ['audio', 'break', 'emphasis', 'p', 'prosody', 's', 'say-as', 'speak', 'sub'];
  const validAmazonTags = ['amazon:effect', 'lang', 'phoneme', 'voice', 'w'];
  const validGoogleTags = ['par', 'seq', 'media', 'desc'];
  let removedTag;

  if (element.name) {
    if ((validTags.indexOf(element.name) === -1) &&
      !(((platform === 'amazon') && (validAmazonTags.indexOf(element.name) !== -1)) ||
      ((platform === 'google') && (validGoogleTags.indexOf(element.name) !== -1)))) {
      errors.push({type: 'tag', tag: element.name});
      parent.elements.splice(index, 1);
      removedTag = true;
    } else {
      // Let's check values based on the tag
      const attributes = Object.keys(element.attributes || {});

      switch (element.name) {
        case 'amazon:effect':
          // Must be name attribute with whispered value
          attributes.forEach((attribute) => {
            if (attribute === 'name') {
              if (['whispered'].indexOf(element.attributes.name) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes.name = 'whispered';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });

          // Also, name is required
          if (attributes.length === 0) {
            errors.push(createTagError(element, 'none'));
            element.attributes = {name: 'whispered'};
          }
          break;
        case 'audio':
          // Must be src attribute
          attributes.forEach((attribute) => {
            if ((platform === 'google') && (attribute === 'clipBegin')) {
              if (readDuration(element.attributes.clipBegin, platform) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.clipBegin = undefined;
              }
            } else if ((platform === 'google') && (attribute === 'clipEnd')) {
              if (readDuration(element.attributes.clipEnd, platform) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.clipEnd = undefined;
              }
            } else if ((platform === 'google') && (attribute === 'speed')) {
              if (element.attributes.speed.match(/^(\+)?[0-9]+(\.[0-9]+)?%$/g)) {
                // Number must be between 50 and 200
                const speed = parseFloat(element.attributes.speed);
                if (speed < 50) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.speed = '50%';
                }
                if (speed > 200) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.speed = '200%';
                }
              } else {
                errors.push(createTagError(element, attribute));
                element.attributes.speed = '100%';
              }
            } else if ((platform === 'google') && (attribute === 'repeatCount')) {
              if (!element.attributes.repeatCount.match(/^(\+)?[0-9]+(\.[0-9]+)?$/g)) {
                errors.push(createTagError(element, attribute));
                element.attributes.repeatCount = '1';
              }
            } else if ((platform === 'google') && (attribute === 'repeatDur')) {
              if (readDuration(element.attributes.repeatDur, platform) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.repeatDur = undefined;
              }
            } else if ((platform === 'google') && (attribute === 'soundLevel')) {
              // It's OK if it's of the form +xdB or - xdB; value doesn't matter
              if (element.attributes.soundLevel.match(/^[+-][0-9]+(\.[0-9]+)?dB$/g)) {
                const soundLevel = parseFloat(element.attributes.soundLevel);
                if (soundLevel < -40) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.soundLevel = '-40dB';
                }
                if (soundLevel > 40) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.soundLevel = '+40dB';
                }
              } else {
                errors.push(createTagError(element, attribute));
                element.attributes.soundLevel = '+0dB';
              }
            } else if (attribute !== 'src') {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });

          // Also, src is required - if not present remove the whole element
          if (attributes.length === 0) {
            errors.push(createTagError(element, 'none'));
            parent.elements.splice(index, 1);
          }
          break;
        case 'break':
          // Attribute must be time or strength
          attributes.forEach((attribute) => {
            if (attribute === 'strength') {
              if (['none', 'x-weak', 'weak', 'medium', 'strong', 'x-strong']
                .indexOf(element.attributes.strength) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes.strength = 'medium';
              }
            } else if (attribute === 'time') {
              // Must be valid duration
              if (readDuration(element.attributes.time, platform, 10000) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.time = '10s';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });

          // If there isn't a strength or time, add one
          if (!element.attributes.strength && !element.attributes.time) {
            element.attributes.strength = 'medium';
          }
          break;
        case 'desc':
          // Desc is valid as part of an audio tag on Google
          if (!parent || (parent.name !== 'audio')) {
            // Invalid in this context
            errors.push({type: 'tag', tag: element.name});
            parent.elements.splice(index, 1);
          }
          break;
        case 'emphasis':
          // Must be level attribute
          attributes.forEach((attribute) => {
            if (attribute === 'level') {
              if (['strong', 'moderate', 'reduced']
                .indexOf(element.attributes.level) === -1) {
                // None is also allowed on Google
                if ((platform !== 'google') || (element.attributes.level !== 'none')) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.level = 'moderate';
                }
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });

          // Also, level is required
          if (attributes.length === 0) {
            errors.push(createTagError(element, 'none'));
            element.attributes = {level: 'moderate'};
          }
          break;
        case 'lang':
          // Must be xml:lang attribute
          attributes.forEach((attribute) => {
            if (attribute === 'xml:lang') {
              if (['en-US', 'en-GB', 'en-IN', 'en-AU', 'en-CA', 'de-DE', 'es-ES', 'it-IT', 'ja-JP', 'fr-FR']
                .indexOf(element.attributes['xml:lang']) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes['xml:lang'] = 'en-US';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });

          // Also, xml:lang is required
          if (attributes.length === 0) {
            errors.push(createTagError(element, 'none'));
            element.attributes = {'xml:lang': 'en-US'};
          }
          break;
        case 'media':
          attributes.forEach((attribute) => {
            if (attribute === 'xml:id') {
              if (!element.attributes['xml:id'].match(/^([-_#]|[a-z]|[A-Z]|ß|ö|ä|ü|Ö|Ä|Ü|æ|é|[0-9])+$/g)) {
                errors.push(createTagError(element, attribute));
                element.attributes['xml:id'] = 'id_' + index;
              }
            } else if (attribute === 'begin') {
              if (!element.attributes.begin.match(/^[+-]?[0-9]+(\.[0-9]+)?(h|min|s|ms)$/g)
                && !element.attributes.begin.match(/^([-_#]|[a-z]|[A-Z]|ß|ö|ä|ü|Ö|Ä|Ü|æ|é|[0-9])+\.(begin|end)[+-][0-9]+(\.[0-9]+)?(h|min|s|ms)$/g)) {
                errors.push(createTagError(element, attribute));
                element.attributes.begin = '0';
              }
            } else if (attribute === 'end') {
              if (!element.attributes.end.match(/^[+-]?[0-9]+(\.[0-9]+)?(h|min|s|ms)$/g)
                && !element.attributes.end.match(/^([-_#]|[a-z]|[A-Z]|ß|ö|ä|ü|Ö|Ä|Ü|æ|é|[0-9])+\.(begin|end)[+-][0-9]+(\.[0-9]+)?(h|min|s|ms)$/g)) {
                errors.push(createTagError(element, attribute));
                element.attributes.end = undefined;
              }
            } else if (attribute === 'repeatCount') {
              if (!element.attributes.repeatCount.match(/^(\+)?[0-9]+(\.[0-9]+)?$/g)) {
                errors.push(createTagError(element, attribute));
                element.attributes.repeatCount = '1';
              }
            } else if (attribute === 'repeatDur') {
              if (readDuration(element.attributes.repeatDur, platform) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.repeatDur = undefined;
              }
            } else if (attribute === 'soundLevel') {
              // It's OK if it's of the form +xdB or - xdB; value doesn't matter
              if (!element.attributes.soundLevel.match(/^[+-]?[0-9]+(\.[0-9]+)?dB$/g)) {
                errors.push(createTagError(element, attribute));
                element.attributes.soundLevel = '+0dB';
              }
            } else if (attribute === 'fadeInDur') {
              if (readDuration(element.attributes.fadeInDur, platform) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.fadeInDur = '0s';
              }
            } else if (attribute === 'fadeOutDur') {
              if (readDuration(element.attributes.fadeOutDur, platform) === undefined) {
                errors.push(createTagError(element, attribute));
                element.attributes.fadeOutDur = '0s';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
            }
          });

          break;
        case 'p':
          // No attributes allowed
          attributes.forEach((attribute) => {
            errors.push(createTagError(element, attribute, true));
            element.attributes[attribute] = undefined;
          });
          break;
        case 'par':
        case 'seq':
          // These elements house other par, seq, or media elements
          if (element.elements) {
            let i;
            for (i = 0; i < element.elements.length; i++) {
              const item = element.elements[i];
              if (['par', 'seq', 'media'].indexOf(item.name) === -1) {
                const error = {type: 'tag', tag: element.name};
                error.value = item.name;
                errors.push(error);
                element.elements.splice(i, 1);
                i--;
              }
            }
          }

          break;
        case 'phoneme':
          attributes.forEach((attribute) => {
            if (attribute === 'alphabet') {
              if (['ipa', 'x-sampa']
                .indexOf(element.attributes.alphabet) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes.alphabet = 'ipa';
              }
            } else if (attribute !== 'ph') {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });
          break;
        case 'prosody':
          attributes.forEach((attribute) => {
            if (attribute === 'rate') {
              if (!prosodyRate(element.attributes.rate)) {
                errors.push(createTagError(element, attribute));
                element.attributes.rate = '100%';
              }
            } else if (attribute === 'pitch') {
              if (['x-low', 'low', 'medium', 'high', 'x-high'].indexOf(element.attributes.pitch) === -1) {
                // It's OK, it has to be of the form +x% or -x%
                if (element.attributes.pitch.match(/^\+[0-9]+(\.[0-9]+)?%$/g)) {
                  // Number must be less than 50
                  if (parseFloat(element.attributes.pitch) > 50) {
                    errors.push(createTagError(element, attribute));
                    element.attributes.pitch = '+50%';
                  }
                } else if (element.attributes.pitch.match(/^-[0-9]+(\.[0-9]+)?%$/g)) {
                  // Number must be less than 33.3
                  if (parseFloat(element.attributes.pitch) < -33.3) {
                    errors.push(createTagError(element, attribute));
                    element.attributes.pitch = '-33.3%';
                  }
                } else if ((platform !== 'google') ||
                  !element.attributes.pitch.match(/^[+-]+[0-9]+(\.[0-9]+)?st$/g)) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.pitch = '+1st';
                }
              }
            } else if (attribute === 'volume') {
              if (['silent', 'x-soft', 'soft', 'medium', 'loud', 'x-loud'].indexOf(element.attributes.volume) === -1) {
                // It's OK if it's of the form +xdB or - xdB; value doesn't matter
                if (!element.attributes.volume.match(/^[+-][0-9]+(\.[0-9]+)?dB$/g)) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.volume = '+0dB';
                }
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });
          break;
        case 's':
          // No attributes allowed
          attributes.forEach((attribute) => {
            errors.push(createTagError(element, attribute, true));
            element.attributes[attribute] = undefined;
          });
          break;
        case 'say-as':
          // Attribute must be interpret-as or format
          attributes.forEach((attribute) => {
            if (attribute === 'interpret-as') {
              if (['characters', 'spell-out', 'cardinal', 'ordinal',
                  'fraction', 'unit', 'date', 'time', 'telephone', 'expletive']
                  .indexOf(element.attributes['interpret-as']) === -1) {
                // Some attributes are platform specific
                let supported = false;
                if ((platform === 'amazon') &&
                  ['number', 'digits', 'address', 'interjection']
                  .indexOf(element.attributes['interpret-as'] !== -1)) {
                  supported = true;
                } else if ((platform === 'google') &&
                  ['bleep', 'verbatim'].indexOf(element.attributes['interpret-as'] !== -1)) {
                  supported = true;
                }

                if (!supported) {
                  errors.push(createTagError(element, attribute));
                  element.attributes['interpret-as'] = 'cardinal';
                }
              }
            } else if (attribute === 'format') {
              // Is this in support of a date or a time?
              let isDate = (element.attributes['interpret-as'] === 'date');
              if (isDate) {
                if (['mdy', 'dmy', 'ymd', 'md', 'dm', 'ym',
                    'my', 'd', 'm', 'y'].indexOf(element.attributes.format) === -1) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.format = 'mdy';
                }
              } else if (platform === 'google') {
                // We allow format for time variable
                if (!element.attributes.format.match(/^[hmsZ^\s.!?:;(12|24)]*$/g)) {
                  errors.push(createTagError(element, attribute));
                  element.attributes.format = 'hms12';
                }
              } else {
                // Format for Amazon is only supported on date
                errors.push(createTagError(element, attribute));
                element.attributes.format = undefined;
              }
            } else if ((platform === 'google') && (attribute === 'detail')) {
              if (['1', '2'].indexOf(element.attributes.detail) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes.detail = '1';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });
          break;
        case 'sub':
          // alias is optional
          attributes.forEach((attribute) => {
            if (attribute !== 'alias') {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });
          break;
        case 'voice':
          // Attribute must be name
          attributes.forEach((attribute) => {
            if (attribute === 'name') {
              if (['Ivy', 'Joanna', 'Joey', 'Justin', 'Kendra', 'Kimberly', 'Matthew', 'Salli',
                  'Nicole', 'Russell', 'Amy', 'Brian', 'Emma', 'Aditi', 'Raveena',
                  'Hans', 'Marlene', 'Vicki', 'Conchita', 'Enrique',
                  'Carla', 'Giorgio', 'Mizuki', 'Takumi', 'Celine', 'Lea', 'Mathieu']
                .indexOf(element.attributes.name) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes.name = 'Ivy';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });
          break;
        case 'w':
          // Attribute must be role
          attributes.forEach((attribute) => {
            if (attribute === 'role') {
              if (['amazon:VB', 'amazon:VBD', 'amazon:NN', 'amazon:SENSE_1']
                .indexOf(element.attributes.role) === -1) {
                errors.push(createTagError(element, attribute));
                element.attributes.role = 'amazon:VB';
              }
            } else {
              // Invalid attribute
              errors.push(createTagError(element, attribute, true));
              element.attributes[attribute] = undefined;
            }
          });
          break;
        default:
          break;
      }
    }
  }

  if (element.elements) {
    let index;
    let removed;
    for (index = 0; index < element.elements.length; index++) {
      removed = checkForValidTagsRecursive(element, index, errors, element.elements[index], platform);
      if (removed) {
        // Decrement index since an item was removed
        index--;
      }
    }
  }

  return removedTag;
}

function checkForValidTags(errors, json, platform) {
  checkForValidTagsRecursive(json, 0, errors, json.elements[0], platform);
}

function checkInternal(ssml, options, fix) {
  let errors = [];

  try {
    let result;
    const userOptions = options || {};
    userOptions.platform = userOptions.platform || 'all';

    if (['all', 'amazon', 'google'].indexOf(userOptions.platform) === -1) {
      errors.push({type: 'invalid platform'});
      return Promise.resolve({errors: errors});
    }

    try {
      result = JSON.parse(convert.xml2json(ssml, {compact: false}));
    } catch (err) {
      // Special case - if we replace & with &amp; does it fix it?
      try {
        let text = ssml;
        text = text.replace('&', '&amp;');
        result = JSON.parse(convert.xml2json(text, {compact: false}));

        // OK that worked, let them know it's an & problem
        errors.push({type: 'Invalid & character'});
      } catch(err) {
        // Nope, it's some other error
        errors.push({type: 'Can\'t parse SSML'});
      }

      if (!result || !fix) {
        return Promise.resolve({errors: errors});
      }
    }

    // This needs to be a single item wrapped in a speak tag
    if (!result.elements || (result.elements.length !== 1) ||
      (result.elements[0].name !== 'speak')) {
      errors.push({type: 'tag', tag: 'speak'});
      return Promise.resolve({errors: errors});
    }

    // Make sure only valid tags are present
    checkForValidTags(errors, result, userOptions.platform);

    // Count the audio files - is it more than 5?
    // This isn't allowed for Amazon
    if (userOptions.platform !== 'google') {
      const audio = getAudioFiles(result.elements[0]);
      if (audio.length > 5) {
        errors.push({type: 'Too many audio files'});
        if (fix) {
          removeExtraAudio(result.elements[0]);
        }
      }
    }

    return Promise.resolve({json: result, errors: (errors.length ? errors : undefined)});
  } catch (err) {
    errors.push({type: 'unknown error'});
  }

  return Promise.resolve({errors: (errors.length ? errors : undefined)});
}

module.exports = {
  check: function(ssml, options) {
    return checkInternal(ssml, options)
      .then((result) => {
        return result.errors;
      });
  },
  verifyAndFix: function(ssml, options) {
    return checkInternal(ssml, options, true)
      .then((result) => {
        let ssml;
        if (result.json && result.errors) {
          // We have a corrected result
          ssml = convert.json2xml(result.json, {compact: false});
        }

        return {fixedSSML: ssml, errors: result.errors};
      });
  },
};

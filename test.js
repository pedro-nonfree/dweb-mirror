process.env.DEBUG="dweb-transports dweb-transports:* dweb-mirror:* parallel-streams:* dweb-objects dweb-objects:*";  // Get highest level debugging of these two libraries, must be before require(dweb-transports) //TODO-MIRROR check using GUN for metadata

const MirrorCollection = require('./MirrorCollection.js')
const debug = require('debug')("dweb-mirror:test")
// Other IA repos
global.DwebTransports = require('@internetarchive/dweb-transports');
global.DwebObjects = require('@internetarchive/dweb-objects'); //Includes initializing support for names
const ArchiveItem = require('./ArchiveItemPatched');
const ArchiveFile = require('./ArchiveFilePatched');

//TODO Add tests from each of the classes when/if they exist



let s = new MirrorCollection({itemid:"prelinger"}).streamResults({limit:20, maxpages:2}, (err,res) => console.log("Streamed"))

s.log(m=>["Logging obj %o",m]).reduce()
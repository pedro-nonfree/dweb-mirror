//Standard repos
const fs = require('fs');   // See https://nodejs.org/api/fs.html
const path = require('path');
// Other files from this repo
const MirrorSearch = require('./MirrorSearch');
const stringify = require('canonical-json');
const debug = require('debug')('dweb-mirror:MirrorCollection');
const ParallelStream = require('parallel-streams');

class MirrorCollection extends MirrorSearch {
    /*
    A class to manage an Internet Archive 'Collection' by a special kind of query
    This handles all three kinds of collections since ArchiveItem does: (info in item; list in collection; query in collection)

     */

    constructor(options) {
        /*
        options {
            itemid:     the item to fetch - required if "item" not specified
            item:       if already fetched, usually not
        }
        */
        options.query = 'collection:'+options.itemid; // Used by ArchiveItem.fetch
        options.sort = options.sort || "-downloads"; // Used by ArchiveItem.fetch
        delete options.sort;
        super(options);
    }



    save({cacheDirectory=undefined}={}, cb) {
        /*
            Save _meta and _members as JSON
        */
        super.save({cacheDirectory}, (err) => { // Save meta
            if (err) {
                if (cb) { cb(err); } else { throw(err); } ; // Pass it up (will already have output error to console)
            } else {
                // Now write the members
                let itemid = this.item.metadata.identifier;
                let filepath = path.join(this._dirpath(cacheDirectory), itemid + "_members.json");
                fs.writeFile(filepath,
                    stringify(this.items),
                    (err) => {
                        if (err) {
                            console.error("Unable to write to %s: %s", filepath, err.message);
                            if (cb) { cb(err) } else { throw(err) } ; // Pass it up
                        } else {
                            if (cb) cb(null, this);
                        } } );

            }
        })
    }

    streamResults(options={}, cb) {
        /* Crawl a collection, pass output as stream of the search result objects (can be turned into ArchiveFiles
            data: MirrorCollection (subclass of MirrorSearch & ArchiveItem)
                The ArchiveItem will have numFound, start, page  set after each fetch

            Note this cant easily go in a map to a function on Collection as it recurses

            Pattern:
            streamResults is called, creates and returns stream which is piped by caller
                It calls streamOnePage which does the search and pushes to the stream
                Calls cb when done, or on error.
                This allows the streams to be streamed themselves into a .flatten and if streamResults is run in parallel the results will be unordered.
                e.g.  collectionsStream.map(c => c.streamResults({}) TODO - need example
         */
        if (typeof options === 'function') { cb = options; options = {}; } //Allow missing options
        this.streaming = new ParallelStream({name: `Collection ${this.itemid}`, highWaterMark: 999});

        if (typeof this.page === "undefined") this.page = 0;
        if (!this.limit) this.limit = options.limit;
        let maxpages = this.maxpages ? this.maxpages : options.maxpages;
        let self = this; // this may not be same in call from drain
        streamOnePage();
        return this.streaming;   // return readable stream that can be piped prior to fetch's succeeding

        function streamOnePage() {

            try {
                debug("Searching %s page %d", self.itemid, self.page);
                if (self.page < maxpages && ((typeof(self.numFound) === "undefined") || ((self.start + self.limit) < self.numFound))) {
                    self.page++;
                    // Should fetch next page of search, and metadata on first time, note fetch_query is not passed append=true so will replace items
                    self.fetch_query({append: true, reqThumbnails: false})
                        .then((docs) => {
                            debug("Collection %s page %s retrieved %d items", self.itemid, self.page, docs.length );
                            let ediblearr = docs; // Copy it, in case it is needed by collection
                            _pushbackablewrite();
                            function _pushbackablewrite() { // Asynchronous, recursable
                                // Note consumes eatable array from parent
                                try {
                                    let i;
                                    while (typeof(i = ediblearr.shift()) !== "undefined") {
                                        if (!self.streaming.write(i)) { // It still got written, but there is pushback
                                            self.streaming.debug("Pushing back on array, %d items left", ediblearr.length);
                                            self.streaming.once("drain", _pushbackablewrite);
                                            return; // Without finishing
                                        }
                                    } //while
                                    // Notice the return above will exit if sees backpressure
                                    streamOnePage();    // Outer recursive loop on searching once pushed all first page
                                } catch(err) {
                                    console.error(err);
                                    self.streaming.destroy(new Error(`Failure in ${through.name}._pushbackablewrite: ${err.message}`))
                                }
                            }
                        })
                        .catch((err) => { console.error(err);});
                } else { // Completed loop and each page has fully written to streaming
                    if (options.cacheDirectory) {   // We don't specify a directory, or save in collectionpreseed for example
                        self.save({cacheDirectory: options.cacheDirectory});  //Save meta and members, No cb since wont wait on writing to start searching next collection.
                    }
                    debug("Searches of %s done", self.itemid);
                    self.streaming.end(); // Signal nothing else coming
                    if (cb) { cb(); }
                }
            } catch(err) {
                console.error("Error in streamOnePage", err);
                if (cb) { cb(err); } else { throw err; }
            }
        }
    }
}

exports = module.exports = MirrorCollection;

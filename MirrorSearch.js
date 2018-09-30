const ArchiveItem = require('./ArchiveItemPatched');
const ParallelStream = require('parallel-streams');
const debug = require('debug')('dweb-mirror:MirrorCollection');

class MirrorSearch extends ArchiveItem {
    constructor(options) {
        /*
        Inherited:
        itemid:     the item to fetch - required if "item" not specified
        item:       if already fetched, usually not

        Local - stored and deleted
        query:      Search query (will be specific to collection in MirrorCollection subclass
        sort:  ("-downloads") Sort order (
        other options   Stored on this.options
        */
        super(options); // Use and delete item and itemid
        this.query = options.query; // Used by ArchiveItem.fetch
        delete options.query;
        this.sort = options.sort || "-downloads";   // Used by ArchiveItem.fetch
        delete options.sort;
        this.options = options;
    }
    streamResults(options={}, cb) {
        /* Crawl a search or collection, pass output as stream of the search result objects (can be turned into ArchiveFiles
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
                                    console.error("Caught in streamOnePage.pushbackablewrite", err);
                                    self.streaming.destroy(new Error(`Failure in ${through.name}._pushbackablewrite: ${err.message}`))
                                }
                            }
                        })
                        .catch((err) => {
                            console.error("Caught in streamOnePage.fetch_query", err);
                            self.streaming.destroy(new Error(`Failure in ${through.name}.fetch_query: ${err.message}`))
                        });
                } else { // Completed loop and each page has fully written to streaming
                    if (options.cacheDirectory) {   // We don't specify a directory, or save in collectionpreseed for example
                        self.save({cacheDirectory: options.cacheDirectory});  //Save meta and members, No cb since wont wait on writing to start searching next collection.
                    }
                    debug("Searches of %s done", self.itemid);
                    self.streaming.end(); // Signal nothing else coming
                    if (cb) { cb(); }
                }
            } catch(err) {
                console.error("Caught in streamOnePage outer level", err);
                if (cb) { cb(err); } else { throw err; }
            }
        }
    }

}

exports = module.exports = MirrorSearch;
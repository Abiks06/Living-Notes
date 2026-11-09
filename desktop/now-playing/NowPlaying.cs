// Tells the app what Windows' media sessions are playing, and passes on play, pause and skip.
// It writes one JSON message per line to stdout, reads commands from stdin, and exits when stdin
// closes, so it can't outlive the app. It only runs while System audio is on.
//
// Every Windows call happens on the one main thread. These objects refuse to be used from a
// thread they weren't made for, which is what async continuations would do.
//
// Built by build.mjs with the compiler that comes with Windows, which stops at C# 5.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

static class NowPlaying
{
    const int PollMs = 750;
    /** Artwork past this isn't worth sending through a pipe. */
    const int MaxArtBytes = 4 * 1024 * 1024;

    static GlobalSystemMediaTransportControlsSessionManager manager;
    static readonly object Writing = new object();
    /** A song's picture can arrive seconds after its name, so it's looked at again for a while. */
    const int ArtSettleMs = 12000;
    /** After that only now and then, in case an app swaps it late. */
    const int ArtRecheckMs = 10000;
    /** How long a picture identical to the last song's is held back as probably left over. */
    const int ArtStaleMs = 3500;

    /** The picture last sent for each song, as a hash of its bytes. */
    static readonly Dictionary<string, ulong> ArtSent = new Dictionary<string, ulong>();
    /** Per app: the song it's on, when that began, and the picture the song before it had. */
    static readonly Dictionary<string, string> KeyOf = new Dictionary<string, string>();
    static readonly Dictionary<string, long> KeySince = new Dictionary<string, long>();
    static readonly Dictionary<string, ulong> ArtBefore = new Dictionary<string, ulong>();
    static readonly Dictionary<string, long> ArtChecked = new Dictionary<string, long>();
    static readonly System.Diagnostics.Stopwatch Clock = System.Diagnostics.Stopwatch.StartNew();
    static readonly AutoResetEvent Changed = new AutoResetEvent(false);
    static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    static TextWriter output;

    [MTAThread]
    static void Main()
    {
        output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        manager = Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
        new Thread(ReadCommands) { IsBackground = true }.Start();

        string last = null;
        while (true)
        {
            string command;
            while (Commands.TryDequeue(out command))
            {
                string[] parts = command.Split('\t');
                if (parts.Length == 3) Perform(parts[0], parts[1], parts[2]);
            }
            string snapshot = Snapshot();
            if (snapshot != last)
            {
                last = snapshot;
                Send(snapshot);
            }
            Changed.WaitOne(PollMs);
        }
    }

    /** Waits right here, so the work carries on on this thread and no other. */
    static T Wait<T>(IAsyncOperation<T> operation)
    {
        using (var finished = new ManualResetEventSlim(false))
        {
            operation.Completed = (done, status) => finished.Set();
            finished.Wait();
        }
        if (operation.Status == AsyncStatus.Completed) return operation.GetResults();
        throw operation.ErrorCode ?? new InvalidOperationException(operation.Status.ToString());
    }

    static void Send(string line)
    {
        lock (Writing)
        {
            output.WriteLine(line);
            output.Flush();
        }
    }

    /** Commands are "verb<tab>session id<tab>title". The title tells apart two tabs of one browser. */
    static void ReadCommands()
    {
        string line;
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        while ((line = input.ReadLine()) != null)
        {
            Commands.Enqueue(line);
            Changed.Set();
        }
        Environment.Exit(0);
    }

    static void Perform(string verb, string id, string title)
    {
        try
        {
            GlobalSystemMediaTransportControlsSession target = null;
            foreach (var session in manager.GetSessions())
            {
                if (session.SourceAppUserModelId != id) continue;
                var media = Wait(session.TryGetMediaPropertiesAsync());
                if (target == null || media.Title == title) target = session;
                if (media.Title == title) break;
            }
            if (target == null) return;
            if (verb == "toggle") Wait(target.TryTogglePlayPauseAsync());
            else if (verb == "next") Wait(target.TrySkipNextAsync());
            else if (verb == "previous") Wait(target.TrySkipPreviousAsync());
        }
        catch (Exception)
        {
            // The app it was aimed at has just closed.
        }
    }

    static string Snapshot()
    {
        var json = new StringBuilder("{\"type\":\"sessions\",\"sessions\":[");
        bool first = true;
        foreach (var session in manager.GetSessions())
        {
            try
            {
                var media = Wait(session.TryGetMediaPropertiesAsync());
                var playback = session.GetPlaybackInfo();
                var timeline = session.GetTimelineProperties();
                var controls = playback.Controls;
                string id = session.SourceAppUserModelId;
                string key = id + "|" + media.Title + "|" + media.Artist;
                if (!first) json.Append(',');
                first = false;
                json.Append("{\"id\":").Append(Quote(id));
                json.Append(",\"key\":").Append(Quote(key));
                json.Append(",\"title\":").Append(Quote(media.Title));
                json.Append(",\"artist\":").Append(Quote(media.Artist));
                json.Append(",\"album\":").Append(Quote(media.AlbumTitle));
                json.Append(",\"status\":").Append(Quote(playback.PlaybackStatus.ToString().ToLowerInvariant()));
                json.Append(",\"position\":").Append(Number(timeline.Position.TotalSeconds));
                json.Append(",\"duration\":").Append(Number(timeline.EndTime.TotalSeconds));
                json.Append(",\"updated\":").Append(timeline.LastUpdatedTime.ToUnixTimeMilliseconds());
                json.Append(",\"canToggle\":").Append(controls.IsPlayPauseToggleEnabled ? "true" : "false");
                json.Append(",\"canNext\":").Append(controls.IsNextEnabled ? "true" : "false");
                json.Append(",\"canPrevious\":").Append(controls.IsPreviousEnabled ? "true" : "false");
                json.Append('}');
                CheckArt(id, key, media.Thumbnail);
            }
            catch (Exception)
            {
                // A session can vanish between being listed and being read.
            }
        }
        return json.Append("]}").ToString();
    }

    /**
     * Sends a song's picture when it's new or has changed. Apps, browsers above all, change the
     * name first and the picture a moment later, so reading it once pinned the last song's cover
     * to the next song for good. It's read again while the song is new, and a picture that's
     * byte for byte the last song's is held back briefly in case the real one is on its way.
     */
    static void CheckArt(string id, string key, IRandomAccessStreamReference thumbnail)
    {
        long now = Clock.ElapsedMilliseconds;
        string keyBefore;
        if (!KeyOf.TryGetValue(id, out keyBefore) || keyBefore != key)
        {
            ulong shown;
            if (keyBefore != null && ArtSent.TryGetValue(keyBefore, out shown)) ArtBefore[id] = shown;
            else ArtBefore.Remove(id);
            KeyOf[id] = key;
            KeySince[id] = now;
            ArtChecked.Remove(key);
        }
        long age = now - KeySince[id];
        long last;
        bool looked = ArtChecked.TryGetValue(key, out last);
        if (looked && age > ArtSettleMs && now - last < ArtRecheckMs) return;
        ArtChecked[key] = now;
        if (thumbnail == null) return;

        try
        {
            var stream = Wait(thumbnail.OpenReadAsync());
            if (stream.Size == 0 || stream.Size > MaxArtBytes) return;
            var bytes = new byte[stream.Size];
            var reader = new DataReader(stream);
            Wait<uint>(reader.LoadAsync((uint)stream.Size));
            reader.ReadBytes(bytes);

            ulong hash = Hash(bytes);
            ulong sent;
            if (ArtSent.TryGetValue(key, out sent) && sent == hash) return;
            ulong before;
            bool leftOver = ArtBefore.TryGetValue(id, out before) && before == hash;
            // Two songs from one album do share a cover, so past the wait it's believed.
            if (leftOver && age < ArtStaleMs) return;

            ArtSent[key] = hash;
            string type = string.IsNullOrEmpty(stream.ContentType) ? "image/png" : stream.ContentType;
            string url = "data:" + type + ";base64," + Convert.ToBase64String(bytes);
            Send("{\"type\":\"art\",\"key\":" + Quote(key) + ",\"url\":" + Quote(url) + "}");
        }
        catch (Exception)
        {
            // The picture went away while it was being read. It's looked at again next time.
        }
    }

    static ulong Hash(byte[] bytes)
    {
        ulong hash = 14695981039346656037UL;
        foreach (byte b in bytes) hash = (hash ^ b) * 1099511628211UL;
        return hash ^ (ulong)bytes.Length;
    }

    static string Number(double value)
    {
        return value.ToString("0.###", CultureInfo.InvariantCulture);
    }

    static string Quote(string text)
    {
        var json = new StringBuilder("\"");
        foreach (char c in text ?? "")
        {
            if (c == '"' || c == '\\') json.Append('\\').Append(c);
            else if (c < ' ') json.Append("\\u").Append(((int)c).ToString("x4"));
            else json.Append(c);
        }
        return json.Append('"').ToString();
    }
}

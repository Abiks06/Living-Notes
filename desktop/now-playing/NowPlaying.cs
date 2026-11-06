// Tells the app what Windows' media sessions are playing, and passes on play, pause and skip.
// It writes one JSON message per line to stdout, reads commands from stdin, and exits when stdin
// closes, so it can't outlive the app. It only runs while System audio is on.
//
// Built by build.mjs with the compiler that comes with Windows, which stops at C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
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
    static readonly HashSet<string> ArtSent = new HashSet<string>();
    static readonly AutoResetEvent Changed = new AutoResetEvent(false);
    static TextWriter output;

    static void Main()
    {
        output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        Run().GetAwaiter().GetResult();
    }

    static async Task Run()
    {
        manager = await Done(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
        new Thread(ReadCommands) { IsBackground = true }.Start();

        string last = null;
        while (true)
        {
            string snapshot = await Snapshot();
            if (snapshot != last)
            {
                last = snapshot;
                Send(snapshot);
            }
            Changed.WaitOne(PollMs);
        }
    }

    /** Windows' own async operations, waited for without needing the .NET helpers for them. */
    static Task<T> Done<T>(IAsyncOperation<T> operation)
    {
        var result = new TaskCompletionSource<T>();
        operation.Completed = (finished, status) =>
        {
            if (status == AsyncStatus.Completed) result.SetResult(finished.GetResults());
            else result.SetException(new InvalidOperationException(status.ToString()));
        };
        return result.Task;
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
            string[] parts = line.Split('\t');
            if (parts.Length == 3) Perform(parts[0], parts[1], parts[2]).Wait();
            Changed.Set();
        }
        Environment.Exit(0);
    }

    static async Task Perform(string verb, string id, string title)
    {
        try
        {
            GlobalSystemMediaTransportControlsSession target = null;
            foreach (var session in manager.GetSessions())
            {
                if (session.SourceAppUserModelId != id) continue;
                var media = await Done(session.TryGetMediaPropertiesAsync());
                if (target == null || media.Title == title) target = session;
                if (media.Title == title) break;
            }
            if (target == null) return;
            if (verb == "toggle") await Done(target.TryTogglePlayPauseAsync());
            else if (verb == "next") await Done(target.TrySkipNextAsync());
            else if (verb == "previous") await Done(target.TrySkipPreviousAsync());
        }
        catch (Exception)
        {
            // The app it was aimed at has just closed.
        }
    }

    static async Task<string> Snapshot()
    {
        var json = new StringBuilder("{\"type\":\"sessions\",\"sessions\":[");
        bool first = true;
        foreach (var session in manager.GetSessions())
        {
            try
            {
                var media = await Done(session.TryGetMediaPropertiesAsync());
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
                if (ArtSent.Add(key)) await SendArt(key, media.Thumbnail);
            }
            catch (Exception)
            {
                // A session can vanish between being listed and being read.
            }
        }
        return json.Append("]}").ToString();
    }

    static async Task SendArt(string key, IRandomAccessStreamReference thumbnail)
    {
        if (thumbnail == null) return;
        var stream = await Done(thumbnail.OpenReadAsync());
        if (stream.Size == 0 || stream.Size > MaxArtBytes) return;
        var bytes = new byte[stream.Size];
        var reader = new DataReader(stream);
        await Done<uint>(reader.LoadAsync((uint)stream.Size));
        reader.ReadBytes(bytes);
        string type = string.IsNullOrEmpty(stream.ContentType) ? "image/png" : stream.ContentType;
        string url = "data:" + type + ";base64," + Convert.ToBase64String(bytes);
        Send("{\"type\":\"art\",\"key\":" + Quote(key) + ",\"url\":" + Quote(url) + "}");
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

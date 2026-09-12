# Claude Code Notification hook: Windows toast when Claude needs input.
# Receives hook JSON on stdin; shows the notification message as a toast.
try {
    $raw = [Console]::In.ReadToEnd()
    $msg = "Claude Code needs input"
    if ($raw) {
        try {
            $j = $raw | ConvertFrom-Json
            if ($j.message) { $msg = [string]$j.message }
        } catch {}
    }

    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

    # PowerShell's registered AppUserModelID -- toasts from unregistered app ids are dropped.
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

    $escaped = [System.Security.SecurityElement]::Escape($msg)
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast scenario=""reminder""><visual><binding template=""ToastText02""><text id=""1"">Claude Code</text><text id=""2"">$escaped</text></binding></visual></toast>")

    $toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
    # Never block Claude on a failed toast.
    exit 0
}

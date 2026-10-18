$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'QQ Mail Assistant - Server Secrets'
$form.Size = New-Object Drawing.Size(520,290)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$hint = New-Object Windows.Forms.Label
$hint.Text = 'Enter QQ mailbox and authorization code. Values are sent only to Cloudflare Secrets; never saved locally.'
$hint.Location = New-Object Drawing.Point(20,15)
$hint.Size = New-Object Drawing.Size(465,45)
$form.Controls.Add($hint)
$accountLabel = New-Object Windows.Forms.Label
$accountLabel.Text = 'QQ email (hidden)'
$accountLabel.Location = New-Object Drawing.Point(20,76)
$accountLabel.Width = 160
$form.Controls.Add($accountLabel)
$account = New-Object Windows.Forms.TextBox
$account.Location = New-Object Drawing.Point(185,72)
$account.Width = 295
$account.UseSystemPasswordChar = $true
$form.Controls.Add($account)
$codeLabel = New-Object Windows.Forms.Label
$codeLabel.Text = 'QQ authorization code'
$codeLabel.Location = New-Object Drawing.Point(20,121)
$codeLabel.Width = 160
$form.Controls.Add($codeLabel)
$code = New-Object Windows.Forms.TextBox
$code.Location = New-Object Drawing.Point(185,117)
$code.Width = 295
$code.UseSystemPasswordChar = $true
$form.Controls.Add($code)
$ok = New-Object Windows.Forms.Button
$ok.Text = 'Save to Cloudflare'
$ok.Location = New-Object Drawing.Point(280,185)
$ok.Size = New-Object Drawing.Size(200,35)
$ok.DialogResult = [Windows.Forms.DialogResult]::OK
$form.Controls.Add($ok)
$form.AcceptButton = $ok
$form.Add_Shown({ $form.Activate(); $form.BringToFront(); $account.Focus() })
if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { exit 2 }
$email = $account.Text.Trim()
$auth = $code.Text.Trim()
if ($email -notmatch '^[^\s@]+@qq\.com$' -or $auth -notmatch '^[A-Za-z0-9]{12,64}$') { exit 3 }
$result = @{ QQ_EMAIL_ACCOUNT = $email; QQ_EMAIL_AUTH_CODE = $auth } | ConvertTo-Json -Compress
$account.Clear()
$code.Clear()
$form.Dispose()
# stdout is an anonymous pipe to the provisioning parent, never a console or log.
[Console]::Out.Write($result)

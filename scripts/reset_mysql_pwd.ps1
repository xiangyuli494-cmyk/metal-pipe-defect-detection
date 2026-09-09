# 重置 MySQL root 密码（Windows）
# 用法（管理员 PowerShell）：.\scripts\reset_mysql_pwd.ps1
$serviceName = "MySQL80"
$newPassword = "123456"

Write-Host "停止 MySQL 服务..."
Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue

Write-Host "以跳过权限表方式启动 MySQL..."
$mysqlBin = (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" | Select-Object -ExpandProperty PathName).Trim('"')
$myCnf = Join-Path $env:ProgramData "my.ini"
Start-Process -FilePath $mysqlBin -ArgumentList @(
    "--defaults-file=`"$myCnf`"",
    "--console",
    "--skip-grant-tables",
    "--skip-networking"
) -RedirectStandardOutput "mysqld_skip.log" -RedirectStandardError "mysqld_skip2.log"

Start-Sleep -Seconds 5

Write-Host "重置密码..."
& mysql -uroot -e "FLUSH PRIVILEGES; ALTER USER 'root'@'localhost' IDENTIFIED BY '$newPassword'; FLUSH PRIVILEGES;"

Write-Host "重启 MySQL..."
Stop-Process -Name mysqld -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Service -Name $serviceName

Write-Host "完成。新密码: $newPassword" -ForegroundColor Green
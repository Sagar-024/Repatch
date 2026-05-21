import ora, { Ora } from 'ora';
import chalk from 'chalk';

class Logger {
  private spinner: Ora | null = null;
  private isDebug = process.env.DEBUG === 'true';

  start(message: string) {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora({
      text: chalk.blue(message),
      color: 'cyan',
    }).start();
  }

  update(message: string) {
    if (this.spinner) {
      this.spinner.text = chalk.blue(message);
    } else {
      this.start(message);
    }
  }

  succeed(message: string) {
    if (this.spinner) {
      this.spinner.succeed(chalk.green(message));
      this.spinner = null;
    } else {
      console.log(chalk.green(`✔ ${message}`));
    }
  }

  fail(message: string) {
    if (this.spinner) {
      this.spinner.fail(chalk.red(message));
      this.spinner = null;
    } else {
      console.log(chalk.red(`✖ ${message}`));
    }
  }

  error(message: string) {
    this.stopSpinner();
    console.error(chalk.red(`✖ ${message}`));
  }

  info(message: string) {
    this.stopSpinner();
    console.log(chalk.cyan(`ℹ ${message}`));
  }

  warn(message: string) {
    this.stopSpinner();
    console.log(chalk.yellow(`⚠ ${message}`));
  }

  debug(message: string) {
    if (this.isDebug) {
      this.stopSpinner();
      console.log(chalk.gray(`[DEBUG] ${message}`));
    }
  }

  log(message: string) {
    this.stopSpinner();
    console.log(message);
  }

  private stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}

export const logger = new Logger();

import contextlib
import importlib.util
import io
import subprocess
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "publish-docker.py"
SPEC = importlib.util.spec_from_file_location("publish_docker", SCRIPT)
publish = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publish)


class PublishDockerTests(unittest.TestCase):
    def plan(self, *args):
        parsed = publish.parser().parse_args(args)
        platforms = publish.validate(parsed, publish.parser())
        return parsed, publish.commands(parsed, platforms)

    def test_default_is_version_tagged_local_build_without_push(self):
        _, plan = self.plan("darshbhilwara", "1.2.3")
        command = plan[0]
        self.assertEqual(command[:2], ["docker", "build"])
        self.assertIn("darshbhilwara/bookmarksman:1.2.3", command)
        self.assertNotIn("--push", command)
        self.assertIn("--load", command)
        self.assertNotIn("latest", command)
        self.assertIn(str(publish.ROOT / "server"), command)

    def test_latest_is_explicit_and_version_is_passed_as_label_arg(self):
        _, plan = self.plan("team", "2.0.0", "--latest")
        command = plan[0]
        self.assertIn("team/bookmarksman:2.0.0", command)
        self.assertIn("team/bookmarksman:latest", command)
        self.assertIn("BOOKMARKSMAN_VERSION=2.0.0", command)

    def test_multiplatform_buildx_publishes_both_tags(self):
        _, plan = self.plan("team", "2.0.0", "--platforms", "linux/amd64,linux/arm64", "--push")
        command = plan[0]
        self.assertEqual(command[:3], ["docker", "buildx", "build"])
        self.assertIn("linux/amd64,linux/arm64", command)
        self.assertIn("--push", command)
        self.assertNotIn("--load", command)

    def test_single_platform_build_loads_image_locally_without_push(self):
        _, plan = self.plan("team", "1.0.0", "--platforms", "linux/amd64")
        command = plan[0]
        self.assertEqual(command[:3], ["docker", "buildx", "build"])
        self.assertIn("--load", command)
        self.assertNotIn("--push", command)

    def test_dry_run_does_not_require_or_call_docker(self):
        output = io.StringIO()
        with mock.patch.object(publish.shutil, "which", side_effect=AssertionError("should not inspect Docker")), \
             mock.patch.object(publish.subprocess, "run", side_effect=AssertionError("should not run Docker")), \
             contextlib.redirect_stdout(output):
            result = publish.main(["team", "1.0.0", "--dry-run"])
        self.assertEqual(result, 0)
        self.assertIn("docker build", output.getvalue())
        self.assertNotIn("--push", output.getvalue())

    def test_invalid_names_versions_and_implicit_latest_are_rejected(self):
        for args in (
            ["../team", "1.0.0"],
            ["team", "latest"],
            ["team", "1.0.0", "--platforms", "linux/amd64,linux/arm64"],
        ):
            with self.subTest(args=args), self.assertRaises(SystemExit) as raised:
                publish.main(args)
            self.assertEqual(raised.exception.code, 2)

    def test_missing_docker_cli_fails_clearly(self):
        error = io.StringIO()
        with mock.patch.object(publish.shutil, "which", return_value=None), contextlib.redirect_stderr(error):
            result = publish.main(["team", "1.0.0"])
        self.assertEqual(result, 2)
        self.assertIn("Docker CLI not found", error.getvalue())

    def test_failed_build_does_not_run_any_later_publish_command(self):
        error = io.StringIO()
        with mock.patch.object(publish.shutil, "which", return_value="/usr/bin/docker"), \
             mock.patch.object(
                 publish.subprocess,
                 "run",
                 return_value=subprocess.CompletedProcess(["docker"], returncode=17),
             ) as run, \
             contextlib.redirect_stderr(error):
            result = publish.main(["team", "1.0.0"])
        self.assertEqual(result, 17)
        run.assert_called_once()
        self.assertNotIn("--push", run.call_args.args[0])
        self.assertNotIn("capture_output", run.call_args.kwargs)
        self.assertIn("exit code 17", error.getvalue())

    def test_docker_launch_failure_has_actionable_error(self):
        error = io.StringIO()
        with mock.patch.object(publish.shutil, "which", return_value="/usr/bin/docker"), \
             mock.patch.object(publish.subprocess, "run", side_effect=PermissionError("execution denied")), \
             contextlib.redirect_stderr(error):
            result = publish.main(["team", "1.0.0"])
        self.assertEqual(result, 1)
        self.assertIn("could not launch Docker", error.getvalue())


if __name__ == "__main__":
    unittest.main()
